# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Hunyuan3D-2 (`hy3dgen`) is Tencent's image/text-to-3D generation library: a two-stage pipeline that first
generates a bare mesh from an image (shape generation) and then synthesizes a PBR/albedo texture map for
that mesh (texture generation). It ships as an installable Python package plus a Gradio demo app, a FastAPI
inference server, and a Blender addon that talks to that server.

## Install / build

```bash
pip install -r requirements.txt
pip install -e .

# Required native extensions for texture generation (need a C++ compiler; custom_rasterizer needs nvcc/CUDA):
cd hy3dgen/texgen/custom_rasterizer && python3 setup.py install && cd ../../..
cd hy3dgen/texgen/differentiable_renderer && python3 setup.py install && cd ../../..
```

There is no test suite in this repo — verification is done by actually running the pipelines (see below), not
via `pytest`. There is no lint config either; match the style of surrounding code.

Docs (Sphinx) live under `docs/` and build with `make html` from that directory (output at `docs/build/html`).

## Running things

- Minimal script usage: `python minimal_demo.py`, `python minimal_vae_demo.py`
- More scenarios (multiview, flashvdm/turbo, texture-only on a handcrafted mesh, text-to-3D) live under
  `examples/` — read the relevant script before use, they double as the primary usage documentation.
- Gradio app: `python3 gradio_app.py --model_path <hf-repo> --subfolder <shape-model-subfolder> --texgen_model_path tencent/Hunyuan3D-2 [--low_vram_mode] [--enable_flashvdm]`
  Model/subfolder combos (standard vs turbo, mini/mv/full) are documented in `README.md` under "Gradio App".
- API server: `python api_server.py --host 0.0.0.0 --port 8080`, then `POST /generate` with a base64 image
  (see `README.md` for a curl example). `blender_addon.py` is a client of this server, not a standalone tool.
- Model weights are pulled from Hugging Face on first use (`huggingface_hub.snapshot_download`) into
  `$HY3DGEN_MODELS` (default `~/.cache/hy3dgen`), or loaded from a local path if one already exists there.
  Set `HY3DGEN_DEBUG=1` to get CUDA-event timing logs from `synchronize_timer` (see `hy3dgen/shapegen/utils.py`).

## Architecture

Two independent subpackages under `hy3dgen/`, wired together only by user code (e.g. `gradio_app.py`,
`api_server.py`, `examples/*.py`) — shape output feeds into texture input as a `trimesh.Trimesh`:

### `hy3dgen/shapegen/` — image/multiview → mesh

- `pipelines.py`: `Hunyuan3DDiTPipeline` (base) and `Hunyuan3DDiTFlowMatchingPipeline` (the actual
  diffusers-style entry point: `from_pretrained(repo_id)` / `from_single_file(ckpt, config)` then
  `pipeline(image=...)` to run the full denoise → decode → mesh-extraction loop). Config-driven component
  instantiation goes through `instantiate_from_config`/`get_obj_from_str` (Hydra/OmegaConf-style `target`
  strings, with a `hy3dshape` → `hy3dgen.shapegen` compatibility rewrite for old configs).
- `models/denoisers/`: the flow-matching DiT itself (`hunyuan3ddit.py`, `hunyuandit.py`, `moe_layers.py`).
- `models/autoencoders/`: `ShapeVAE` and friends — encodes/decodes the implicit shape representation;
  `volume_decoders.py` turns latents into a volume/field, `surface_extractors.py` (`SurfaceExtractors`, a
  dict of marching-cubes variants keyed by algo name, e.g. `'mc'`/`'dmc'`) extracts the mesh surface from it —
  selectable via `pipeline.set_surface_extractor(mc_algo)` or as an argument to `pipeline.enable_flashvdm(mc_algo=...)`,
  which also swaps in a turbo VAE checkpoint and turns on FlashVDM's adaptive-KV decoding.
  `surface_loaders.py` handles point-cloud/surface conditioning inputs.
  `attention_blocks.py`/`attention_processors.py` are shared transformer building blocks.
- `models/conditioner.py`: image/multiview conditioning encoders (DINOv2-based) fed into the DiT.
  `preprocessors.py` (`ImageProcessorV2`, `IMAGE_PROCESSORS`) handles input image prep (background removal
  hookup, resizing/padding) before it reaches the conditioner.
  `schedulers.py`: flow-matching noise schedulers (`retrieve_timesteps` in `pipelines.py` bridges to them).
- `postprocessors.py`: mesh cleanup applied to raw DiT output — `FloaterRemover`, `DegenerateFaceRemover`,
  `FaceReducer`, `MeshSimplifier`. These are composable, applied in sequence after generation.
- `smart_load_model`/`synchronize_timer` (`utils.py`) are the shared model-download and CUDA-timing helpers
  used across the package.

### `hy3dgen/texgen/` — mesh + image → textured mesh

- `pipelines.py`: `Hunyuan3DPaintPipeline`/`Hunyuan3DTexGenConfig`. `from_pretrained` resolves two
  sub-models under one HF repo — `hunyuan3d-delight-v2-0` (lighting removal) and a paint subfolder
  (`hunyuan3d-paint-v2-0` or `-turbo`, mapped via `Hunyuan3DTexGenConfig.pipe_dict` to a hunyuanpaint pipeline
  variant). Flow: render normal/position maps from fixed candidate camera angles
  (`render_normal_multiview`/`render_position_multiview`) → run the multiview diffusion paint model → bake
  views back onto the UV texture (`bake_from_multiview`, "fast" graphcut-style merge by default) → inpaint
  remaining holes (`texture_inpaint`).
- `hunyuanpaint/`: the multiview diffusion UNet/pipeline (`pipeline.py`, `unet/modules.py`) that paints
  consistent textures across the candidate camera views simultaneously.
- `differentiable_renderer/`: `MeshRender` (`mesh_render.py`) — rasterization used both to render
  conditioning maps and to back-project/bake painted views onto the UV atlas; `mesh_processor.py` is a
  native (pybind11) extension built via its own `setup.py`; `camera_utils.py`/`mesh_utils.py` support it.
  By default (`raster_mode='cr'`) it rasterizes via the `custom_rasterizer` CUDA extension below — that
  extension is a hard dependency for texture generation, not an optional speedup.
- `custom_rasterizer/`: the CUDA rasterizer `MeshRender` imports as `custom_rasterizer` (own `setup.py`,
  built with `torch.utils.cpp_extension.CUDAExtension`); must be compiled with nvcc.
- `utils/`: one file per pipeline stage — `dehighlight_utils.py` (`Light_Shadow_Remover`),
  `multiview_utils.py` (`Multiview_Diffusion_Net`), `imagesuper_utils.py` (`Image_Super_Net`, currently
  unused/commented out in `pipelines.py`), `uv_warp_utils.py` (`mesh_uv_wrap`), `simplify_mesh_utils.py`,
  `alignImg4Tex_utils.py`, `counter_utils.py`.

### Other top-level pieces

- `hy3dgen/text2image.py`: `HunyuanDiTPipeline`, used by `gradio_app.py`/`api_server.py` for the
  text-to-image step when the input is a text prompt rather than an image.
- `hy3dgen/rembg.py`: `BackgroundRemover` (wraps `rembg`), used before shape generation on raw photos.
- `gradio_app.py`, `api_server.py`: both orchestrate shapegen → texgen end-to-end; treat them as the
  reference integration code when wiring up a new consumer.
- `blender_addon.py`: Blender UI panel/operators that call an already-running `api_server.py` over HTTP —
  it has no direct dependency on `hy3dgen`.

## Conventions to preserve

- Every source file starts with the Tencent Hunyuan license header block; keep it on new files under
  `hy3dgen/`.
- Config-driven components use the `target`/`params` dict convention consumed by `instantiate_from_config`
  (see `hy3dgen/shapegen/pipelines.py`) — new configurable modules should follow the same shape rather than
  hardcoding construction.
- GPU-timing/debug logging is opt-in via the `HY3DGEN_DEBUG` env var and the `synchronize_timer` helper, not
  ad-hoc prints.
