"""
Hunyuan3D-2 production CLI: image -> textured GLB, on top of the unmodified
upstream hy3dgen package. See docs/PHASE4_PRODUCTION_PIPELINE_WINDOWS.md.
"""
import argparse
import gc
import json
import logging
import re
import shutil
import subprocess
import sys
import time
import traceback
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import torch
import custom_rasterizer_kernel  # noqa: F401  (import ordering validated in Phase 3B)
import mesh_processor  # noqa: F401
import trimesh
from pygltflib import GLTF2

EXIT_OK = 0
EXIT_PREFLIGHT = 2
EXIT_SHAPEGEN = 3
EXIT_REDUCTION = 4
EXIT_TEXGEN = 5
EXIT_VALIDATION = 6

SHAPE_ONLY_MIN_FREE_VRAM_MIB = 6000
TEXTURE_LOW_VRAM_READY_MIB = 9500
TEXTURE_LOW_VRAM_CONFIRM_MIB = 8500
TEXTURE_NO_LOW_VRAM_MIN_MIB = 11000  # conservative default; see docs, mission left this case unspecified
TEXTURE_MIN_FREE_RAM_GIB = 12.0
MIN_FREE_DISK_GIB = 2.0

OUTPUT_FILES = [
    "input.png",
    "shape-original.glb",
    "shape-reduced.glb",
    "textured.glb",
    "metadata.json",
    "generation.log",
]

_TOKEN_PATTERN = re.compile(r"(hf_[A-Za-z0-9]{20,}|[A-Za-z0-9_\-]{32,})")


def redact(text: str) -> str:
    """Redact substrings that look like tokens/secrets before logging."""
    return _TOKEN_PATTERN.sub("<redacted>", text)


class PipelineError(RuntimeError):
    def __init__(self, message, exit_code):
        super().__init__(message)
        self.exit_code = exit_code


@dataclass
class StageTimes:
    shapegen_seconds: Optional[float] = None
    reduction_seconds: Optional[float] = None
    texgen_seconds: Optional[float] = None


@dataclass
class MeshStats:
    original_vertices: Optional[int] = None
    original_faces: Optional[int] = None
    reduced_vertices: Optional[int] = None
    reduced_faces: Optional[int] = None
    textured_vertices: Optional[int] = None
    textured_faces: Optional[int] = None


@dataclass
class PeakVram:
    allocated_gib: float = 0.0
    reserved_gib: float = 0.0

    def update(self):
        if torch.cuda.is_available():
            self.allocated_gib = max(
                self.allocated_gib, torch.cuda.max_memory_allocated() / (1024 ** 3)
            )
            self.reserved_gib = max(
                self.reserved_gib, torch.cuda.max_memory_reserved() / (1024 ** 3)
            )


def parse_args(argv=None):
    p = argparse.ArgumentParser(
        prog="generate_textured_3d.py",
        description="Generate a textured GLB from a single image using Hunyuan3D-2 (unmodified upstream).",
    )
    p.add_argument("--image", required=True, help="Path to the input image")
    p.add_argument("--output-dir", required=True, help="Job output directory (created if missing)")
    p.add_argument("--seed", type=int, default=1234)
    p.add_argument("--shape-steps", type=int, default=5, dest="shape_steps")
    p.add_argument("--guidance-scale", type=float, default=5.0, dest="guidance_scale")
    p.add_argument("--octree-resolution", type=int, default=256, dest="octree_resolution")
    p.add_argument("--max-faces", type=int, default=40000, dest="max_faces")
    p.add_argument("--shape-model", default="tencent/Hunyuan3D-2mini", dest="shape_model")
    p.add_argument(
        "--shape-subfolder", default="hunyuan3d-dit-v2-mini-turbo", dest="shape_subfolder"
    )
    p.add_argument("--texture-model", default="tencent/Hunyuan3D-2", dest="texture_model")
    p.add_argument(
        "--texture-subfolder", default="hunyuan3d-paint-v2-0-turbo", dest="texture_subfolder"
    )
    p.add_argument("--low-vram", action="store_true", dest="low_vram")
    p.add_argument("--shape-only", action="store_true", dest="shape_only")
    p.add_argument("--overwrite", action="store_true")
    return p.parse_args(argv)


def setup_logging(job_dir: Path) -> logging.Logger:
    logger = logging.getLogger("generate_textured_3d")
    logger.setLevel(logging.DEBUG)
    logger.handlers.clear()

    fmt = logging.Formatter("%(asctime)s | %(levelname)-8s | %(message)s", "%Y-%m-%d %H:%M:%S")

    console = logging.StreamHandler(sys.stdout)
    console.setLevel(logging.INFO)
    console.setFormatter(fmt)
    logger.addHandler(console)

    file_handler = logging.FileHandler(job_dir / "generation.log", mode="w", encoding="utf-8")
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(fmt)
    logger.addHandler(file_handler)

    return logger


def output_path(job_dir: Path, name: str) -> Path:
    """Only way to build an output path: guarantees writes stay inside job_dir."""
    if name not in OUTPUT_FILES:
        raise ValueError(f"Unexpected output filename: {name}")
    candidate = (job_dir / name).resolve()
    if candidate.parent != job_dir.resolve():
        raise PipelineError(f"Refusing to write outside job directory: {candidate}", EXIT_PREFLIGHT)
    return candidate


def get_gpu_memory_mib(logger) -> Optional[dict]:
    try:
        out = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total,memory.used,memory.free",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=15,
            check=True,
        )
        name, total, used, free = [x.strip() for x in out.stdout.strip().split(",")]
        return {"name": name, "total_mib": int(total), "used_mib": int(used), "free_mib": int(free)}
    except Exception as exc:
        logger.warning("nvidia-smi query failed: %s", redact(str(exc)))
        return None


def get_free_ram_gib(logger) -> Optional[float]:
    try:
        import psutil

        return psutil.virtual_memory().available / (1024 ** 3)
    except Exception as exc:
        logger.warning("RAM query failed: %s", redact(str(exc)))
        return None


def _extract_args_after_script(cmdline: list, script_name: str) -> Optional[list]:
    """Return the argument list that follows the script's basename in a cmdline, or None."""
    for i, part in enumerate(cmdline):
        try:
            if Path(part).name.lower() == script_name.lower():
                return cmdline[i + 1:]
        except Exception:
            continue
    return None


def check_other_hunyuan_process(logger, own_argv: Optional[list] = None) -> bool:
    """
    Best-effort, read-only scan for another *genuinely different* instance of this
    script already running.

    A naive substring match on the command line is not enough: in some sandboxed
    execution environments (observed in Phase 4B), the very process running this
    check can appear a second time under a different PID with an identical command
    line (a launch-layer artifact, not a real second run). To avoid that false
    positive, a candidate process is only reported as "another instance" if its
    arguments *after* the script name differ from our own (own_argv defaults to
    sys.argv[1:]) -- an exact match is treated as an echo of ourselves, not a
    genuine concurrent run.
    """
    try:
        import os

        import psutil

        script_name = Path(__file__).name
        current_pid = os.getpid()
        own_args = list(sys.argv[1:] if own_argv is None else own_argv)

        for proc in psutil.process_iter(["pid", "name", "cmdline"]):
            if proc.info["pid"] == current_pid:
                continue
            name = (proc.info.get("name") or "").lower()
            if "python" not in name:
                continue
            cmdline = proc.info.get("cmdline") or []
            if not any(script_name.lower() in part.lower() for part in cmdline):
                continue

            candidate_args = _extract_args_after_script(cmdline, script_name)
            if candidate_args is not None and candidate_args == own_args:
                logger.debug(
                    "Ignoring pid=%s: identical arguments to our own invocation "
                    "(launch-layer echo, not a genuine second run).",
                    proc.info["pid"],
                )
                continue

            logger.warning(
                "Another instance appears active: pid=%s cmdline=%s",
                proc.info["pid"],
                redact(" ".join(cmdline)),
            )
            return True
        return False
    except Exception as exc:
        logger.warning("Process scan failed (non-blocking): %s", redact(str(exc)))
        return False


def validate_image(path: Path, logger) -> None:
    from PIL import Image

    if not path.is_file():
        raise PipelineError(f"Input image not found: {path}", EXIT_PREFLIGHT)
    try:
        with Image.open(path) as img:
            img.verify()
        with Image.open(path) as img:
            logger.info("Input image OK: format=%s size=%s mode=%s", img.format, img.size, img.mode)
    except Exception as exc:
        raise PipelineError(f"Input image is not a valid/readable image: {exc}", EXIT_PREFLIGHT)


def save_input_copy_as_png(image_path: Path, dest: Path) -> None:
    """Always materialize the job's input copy as a real PNG, regardless of source format."""
    from PIL import Image

    with Image.open(image_path) as img:
        img.load()
        mode = "RGBA" if img.mode in ("RGBA", "LA", "PA") else "RGB"
        img.convert(mode).save(dest, format="PNG")


def run_preflight(args, job_dir: Path, logger) -> dict:
    logger.info("=== Preflight ===")

    image_path = Path(args.image).expanduser().resolve()
    validate_image(image_path, logger)

    if not torch.cuda.is_available():
        raise PipelineError("CUDA is not available in this environment.", EXIT_PREFLIGHT)
    logger.info("CUDA OK: device=%s", torch.cuda.get_device_name(0))

    # Import already happened at module load time; re-confirm attributes exist.
    if not hasattr(custom_rasterizer_kernel, "__file__"):
        raise PipelineError("custom_rasterizer_kernel does not look importable.", EXIT_PREFLIGHT)
    if not hasattr(mesh_processor, "__file__"):
        raise PipelineError("mesh_processor does not look importable.", EXIT_PREFLIGHT)
    logger.info("custom_rasterizer_kernel and mesh_processor import OK")

    disk = shutil.disk_usage(job_dir.anchor or str(job_dir))
    free_disk_gib = disk.free / (1024 ** 3)
    logger.info("Free disk space on target drive: %.2f GiB", free_disk_gib)
    if free_disk_gib < MIN_FREE_DISK_GIB:
        raise PipelineError(
            f"Not enough free disk space: {free_disk_gib:.2f} GiB < {MIN_FREE_DISK_GIB} GiB required.",
            EXIT_PREFLIGHT,
        )

    gpu_mem = get_gpu_memory_mib(logger)
    if gpu_mem is None:
        raise PipelineError("Could not query GPU memory via nvidia-smi.", EXIT_PREFLIGHT)
    logger.info(
        "GPU: %s | total=%d MiB used=%d MiB free=%d MiB",
        gpu_mem["name"],
        gpu_mem["total_mib"],
        gpu_mem["used_mib"],
        gpu_mem["free_mib"],
    )

    free_ram_gib = get_free_ram_gib(logger)
    if free_ram_gib is None:
        raise PipelineError("Could not query free system RAM.", EXIT_PREFLIGHT)
    logger.info("Free system RAM: %.2f GiB", free_ram_gib)

    if check_other_hunyuan_process(logger):
        raise PipelineError(
            "Another Hunyuan3D generation process appears to be running. "
            "Refusing to start (no process was killed). Re-run once it has finished.",
            EXIT_PREFLIGHT,
        )

    apply_memory_policy(args, gpu_mem, free_ram_gib, logger)

    return {
        "image_path": image_path,
        "gpu": gpu_mem,
        "free_ram_gib": free_ram_gib,
        "free_disk_gib": free_disk_gib,
    }


def apply_memory_policy(args, gpu_mem: dict, free_ram_gib: float, logger) -> None:
    free_vram = gpu_mem["free_mib"]

    if args.shape_only:
        if free_vram < SHAPE_ONLY_MIN_FREE_VRAM_MIB:
            raise PipelineError(
                f"Free VRAM {free_vram} MiB < {SHAPE_ONLY_MIN_FREE_VRAM_MIB} MiB required for shape-only.",
                EXIT_PREFLIGHT,
            )
        logger.info("Memory policy: shape-only, VRAM OK (%d MiB free).", free_vram)
        return

    if free_ram_gib < TEXTURE_MIN_FREE_RAM_GIB:
        raise PipelineError(
            f"Free system RAM {free_ram_gib:.2f} GiB < {TEXTURE_MIN_FREE_RAM_GIB} GiB required for texgen.",
            EXIT_PREFLIGHT,
        )

    if args.low_vram:
        if free_vram >= TEXTURE_LOW_VRAM_READY_MIB:
            logger.info("Memory policy: texgen --low-vram, VRAM OK (%d MiB free).", free_vram)
            return
        if free_vram >= TEXTURE_LOW_VRAM_CONFIRM_MIB:
            logger.warning(
                "Free VRAM %d MiB is between %d and %d MiB: interactive confirmation required.",
                free_vram,
                TEXTURE_LOW_VRAM_CONFIRM_MIB,
                TEXTURE_LOW_VRAM_READY_MIB - 1,
            )
            if not sys.stdin.isatty():
                raise PipelineError(
                    "VRAM in the confirmation zone but no interactive TTY available to confirm.",
                    EXIT_PREFLIGHT,
                )
            try:
                answer = input(
                    f"Free VRAM is only {free_vram} MiB (recommended threshold: "
                    f"{TEXTURE_LOW_VRAM_READY_MIB} MiB). Continue anyway? [y/N] "
                ).strip().lower()
            except (EOFError, OSError):
                # stdin claims to be a tty but has no real interactive input behind it
                # (observed in some sandboxed/automated shells): treat as "cannot confirm".
                raise PipelineError(
                    "VRAM in the confirmation zone but stdin produced no input to confirm.",
                    EXIT_PREFLIGHT,
                )
            if answer != "y":
                raise PipelineError("User declined to continue with marginal VRAM.", EXIT_PREFLIGHT)
            logger.info("User confirmed proceeding with %d MiB free VRAM.", free_vram)
            return
        raise PipelineError(
            f"Free VRAM {free_vram} MiB < {TEXTURE_LOW_VRAM_CONFIRM_MIB} MiB: refusing to start texgen.",
            EXIT_PREFLIGHT,
        )

    # Texture generation without --low-vram: no CPU offload, higher VRAM requirement.
    if free_vram < TEXTURE_NO_LOW_VRAM_MIN_MIB:
        raise PipelineError(
            f"Free VRAM {free_vram} MiB < {TEXTURE_NO_LOW_VRAM_MIN_MIB} MiB required for texgen "
            "without --low-vram (no CPU offload). Retry with --low-vram.",
            EXIT_PREFLIGHT,
        )
    logger.info("Memory policy: texgen without --low-vram, VRAM OK (%d MiB free).", free_vram)


def run_shapegen(args, image_path: Path, logger) -> "tuple[trimesh.Trimesh, float, PeakVram]":
    from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline

    logger.info("=== Shape generation ===")
    logger.info(
        "Loading shape pipeline: model=%s subfolder=%s", args.shape_model, args.shape_subfolder
    )

    torch.cuda.reset_peak_memory_stats()
    peak = PeakVram()
    started = time.perf_counter()
    shape_pipeline = None
    try:
        shape_pipeline = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
            args.shape_model,
            subfolder=args.shape_subfolder,
            use_safetensors=True,
            device="cuda",
        )
        generator = torch.Generator(device="cuda").manual_seed(args.seed)
        outputs = shape_pipeline(
            image=str(image_path),
            num_inference_steps=args.shape_steps,
            guidance_scale=args.guidance_scale,
            generator=generator,
            octree_resolution=args.octree_resolution,
            output_type="trimesh",
        )
        mesh = outputs[0]
        if mesh is None or len(mesh.vertices) == 0 or len(mesh.faces) == 0:
            raise PipelineError("Shape generation produced an empty mesh.", EXIT_SHAPEGEN)
    except PipelineError:
        raise
    except Exception as exc:
        raise PipelineError(f"Shape generation failed: {exc}", EXIT_SHAPEGEN) from exc
    finally:
        del shape_pipeline
        gc.collect()
        torch.cuda.empty_cache()

    elapsed = time.perf_counter() - started
    peak.update()
    logger.info(
        "Shape generation done in %.2fs: vertices=%d faces=%d",
        elapsed,
        len(mesh.vertices),
        len(mesh.faces),
    )
    return mesh, elapsed, peak


def reduce_mesh(mesh: trimesh.Trimesh, max_faces: int, logger) -> "tuple[trimesh.Trimesh, float]":
    from hy3dgen.shapegen import DegenerateFaceRemover, FaceReducer, FloaterRemover

    logger.info("=== Mesh cleanup / reduction ===")
    started = time.perf_counter()
    try:
        mesh = FloaterRemover()(mesh)
        mesh = DegenerateFaceRemover()(mesh)
        if len(mesh.faces) > max_faces:
            mesh = FaceReducer()(mesh, max_facenum=max_faces)
        if len(mesh.vertices) == 0 or len(mesh.faces) == 0:
            raise PipelineError("Mesh is empty after reduction.", EXIT_REDUCTION)
    except PipelineError:
        raise
    except Exception as exc:
        raise PipelineError(f"Mesh reduction failed: {exc}", EXIT_REDUCTION) from exc

    elapsed = time.perf_counter() - started
    logger.info(
        "Reduction done in %.2fs: vertices=%d faces=%d", elapsed, len(mesh.vertices), len(mesh.faces)
    )
    return mesh, elapsed


def run_texgen(args, mesh: trimesh.Trimesh, image_path: Path, logger) -> "tuple[trimesh.Trimesh, float, PeakVram]":
    from hy3dgen.texgen import Hunyuan3DPaintPipeline

    logger.info("=== Texture generation ===")
    logger.info(
        "Loading texture pipeline: model=%s subfolder=%s low_vram=%s",
        args.texture_model,
        args.texture_subfolder,
        args.low_vram,
    )

    torch.cuda.reset_peak_memory_stats()
    peak = PeakVram()
    started = time.perf_counter()
    pipeline = None
    try:
        pipeline = Hunyuan3DPaintPipeline.from_pretrained(
            args.texture_model,
            subfolder=args.texture_subfolder,
        )
        if args.low_vram:
            pipeline.enable_model_cpu_offload()

        textured_mesh = pipeline(mesh, image=str(image_path))
        if not isinstance(textured_mesh, trimesh.Trimesh):
            raise PipelineError(
                f"Unexpected textured mesh type: {type(textured_mesh).__name__}", EXIT_TEXGEN
            )
        if len(textured_mesh.vertices) == 0 or len(textured_mesh.faces) == 0:
            raise PipelineError("Textured mesh is empty.", EXIT_TEXGEN)
    except PipelineError:
        raise
    except Exception as exc:
        raise PipelineError(f"Texture generation failed: {exc}", EXIT_TEXGEN) from exc
    finally:
        del pipeline
        gc.collect()
        torch.cuda.empty_cache()

    elapsed = time.perf_counter() - started
    peak.update()
    logger.info(
        "Texture generation done in %.2fs: vertices=%d faces=%d",
        elapsed,
        len(textured_mesh.vertices),
        len(textured_mesh.faces),
    )
    return textured_mesh, elapsed, peak


def validate_glb(path: Path, require_material: bool, logger) -> dict:
    logger.info("=== GLB validation: %s ===", path.name)
    result = {"path": str(path), "valid": False}
    try:
        if not path.is_file() or path.stat().st_size == 0:
            raise PipelineError(f"GLB missing or empty: {path}", EXIT_VALIDATION)

        scene = trimesh.load(path, force="scene")
        vertices = sum(len(g.vertices) for g in scene.geometry.values())
        faces = sum(len(g.faces) for g in scene.geometry.values())
        result.update(
            {
                "size_bytes": path.stat().st_size,
                "geometries": len(scene.geometry),
                "vertices": vertices,
                "faces": faces,
            }
        )

        ok = len(scene.geometry) > 0 and vertices > 0 and faces > 0

        if require_material:
            gltf = GLTF2().load_binary(str(path))
            materials = len(gltf.materials or [])
            textures = len(gltf.textures or [])
            images = len(gltf.images or [])
            result.update({"materials": materials, "textures": textures, "images": images})
            ok = ok and materials > 0 and textures > 0 and images > 0

        result["valid"] = ok
        if not ok:
            raise PipelineError(f"GLB validation failed for {path}: {result}", EXIT_VALIDATION)
        logger.info("GLB validation OK: %s", result)
        return result
    except PipelineError:
        raise
    except Exception as exc:
        raise PipelineError(f"GLB validation error for {path}: {exc}", EXIT_VALIDATION) from exc


def build_metadata(args, job_dir: Path, preflight: dict, times: StageTimes, stats: MeshStats,
                    peak: PeakVram, validations: list, status: str) -> dict:
    file_sizes = {}
    for name in OUTPUT_FILES:
        p = job_dir / name
        if p.is_file():
            file_sizes[name] = p.stat().st_size

    return {
        "date_utc": datetime.now(timezone.utc).isoformat(),
        "python_version": sys.version,
        "torch_version": torch.__version__,
        "cuda_version": torch.version.cuda,
        "gpu": preflight["gpu"]["name"] if preflight.get("gpu") else None,
        "models": {
            "shape_model": args.shape_model,
            "shape_subfolder": args.shape_subfolder,
            "texture_model": None if args.shape_only else args.texture_model,
            "texture_subfolder": None if args.shape_only else args.texture_subfolder,
        },
        "seed": args.seed,
        "parameters": {
            "shape_steps": args.shape_steps,
            "guidance_scale": args.guidance_scale,
            "octree_resolution": args.octree_resolution,
            "max_faces": args.max_faces,
            "low_vram": args.low_vram,
            "shape_only": args.shape_only,
        },
        "durations_seconds": {
            "shapegen": times.shapegen_seconds,
            "reduction": times.reduction_seconds,
            "texgen": times.texgen_seconds,
        },
        "mesh_stats": {
            "original_vertices": stats.original_vertices,
            "original_faces": stats.original_faces,
            "reduced_vertices": stats.reduced_vertices,
            "reduced_faces": stats.reduced_faces,
            "textured_vertices": stats.textured_vertices,
            "textured_faces": stats.textured_faces,
        },
        "peak_vram_gib": {
            "allocated": round(peak.allocated_gib, 3),
            "reserved": round(peak.reserved_gib, 3),
        },
        "output_file_sizes_bytes": file_sizes,
        "glb_validations": validations,
        "status": status,
    }


def main(argv=None) -> int:
    args = parse_args(argv)

    job_dir = Path(args.output_dir).expanduser().resolve()
    existing_outputs = [job_dir / n for n in OUTPUT_FILES if (job_dir / n).is_file()]
    job_dir.mkdir(parents=True, exist_ok=True)

    if existing_outputs and not args.overwrite:
        print(
            f"ERROR: output directory already contains generated files and --overwrite was not "
            f"given: {job_dir}",
            file=sys.stderr,
        )
        return EXIT_PREFLIGHT

    logger = setup_logging(job_dir)
    logger.info("Job directory: %s", job_dir)

    times = StageTimes()
    stats = MeshStats()
    overall_peak = PeakVram()
    validations = []
    status = "FAILED"
    exit_code = EXIT_OK
    mesh = None
    textured_mesh = None
    preflight = None

    try:
        preflight = run_preflight(args, job_dir, logger)
        image_path = preflight["image_path"]
        save_input_copy_as_png(image_path, output_path(job_dir, "input.png"))

        mesh, times.shapegen_seconds, shape_peak = run_shapegen(args, image_path, logger)
        stats.original_vertices = len(mesh.vertices)
        stats.original_faces = len(mesh.faces)
        mesh.export(output_path(job_dir, "shape-original.glb"))
        overall_peak.allocated_gib = max(overall_peak.allocated_gib, shape_peak.allocated_gib)
        overall_peak.reserved_gib = max(overall_peak.reserved_gib, shape_peak.reserved_gib)

        mesh, times.reduction_seconds = reduce_mesh(mesh, args.max_faces, logger)
        stats.reduced_vertices = len(mesh.vertices)
        stats.reduced_faces = len(mesh.faces)
        mesh.export(output_path(job_dir, "shape-reduced.glb"))

        if args.shape_only:
            validations.append(
                validate_glb(output_path(job_dir, "shape-reduced.glb"), require_material=False, logger=logger)
            )
            status = "SHAPE_ONLY_OK"
        else:
            textured_mesh, times.texgen_seconds, tex_peak = run_texgen(args, mesh, image_path, logger)
            stats.textured_vertices = len(textured_mesh.vertices)
            stats.textured_faces = len(textured_mesh.faces)
            textured_mesh.export(output_path(job_dir, "textured.glb"))
            overall_peak.allocated_gib = max(overall_peak.allocated_gib, tex_peak.allocated_gib)
            overall_peak.reserved_gib = max(overall_peak.reserved_gib, tex_peak.reserved_gib)

            validations.append(
                validate_glb(output_path(job_dir, "textured.glb"), require_material=True, logger=logger)
            )
            status = "TEXTURED_OK"

        exit_code = EXIT_OK

    except PipelineError as exc:
        logger.error("Pipeline error: %s", redact(str(exc)))
        logger.debug("Traceback:\n%s", traceback.format_exc())
        status = f"FAILED:{exc.exit_code}"
        exit_code = exc.exit_code
    except Exception as exc:  # noqa: BLE001
        logger.error("Unexpected error: %s", redact(str(exc)))
        logger.debug("Traceback:\n%s", traceback.format_exc())
        status = "FAILED:UNEXPECTED"
        exit_code = EXIT_TEXGEN if mesh is not None else EXIT_SHAPEGEN
    finally:
        try:
            preflight_for_meta = preflight if preflight is not None else {"gpu": get_gpu_memory_mib(logger)}
            metadata = build_metadata(
                args, job_dir, preflight_for_meta, times, stats, overall_peak, validations, status
            )
            with open(output_path(job_dir, "metadata.json"), "w", encoding="utf-8") as f:
                json.dump(metadata, f, indent=2)
        except Exception as exc:  # noqa: BLE001
            logger.error("Failed to write metadata.json: %s", redact(str(exc)))

        del mesh
        del textured_mesh
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        logger.info("=== Summary ===")
        logger.info("Status: %s", status)
        logger.info("Job directory: %s", job_dir)
        logger.info("Exit code: %d", exit_code)

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
