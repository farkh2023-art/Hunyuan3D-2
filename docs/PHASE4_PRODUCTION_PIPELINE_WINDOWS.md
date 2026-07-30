# Phase 4 — Pipeline de production Windows : image → GLB texturé

Date : 2026-07-30. Suite de [`PHASE3B_TEXTURED_GENERATION_WINDOWS.md`](PHASE3B_TEXTURED_GENERATION_WINDOWS.md)
(`TEXTURED_GENERATION_READY`, `VISUAL_VALIDATION_PASSED`). Cette phase livre un pipeline CLI
réutilisable au-dessus du package `hy3dgen` **non modifié**, plus un lanceur PowerShell et sa
documentation. Aucune génération lourde complète n'a été relancée dans cette phase — uniquement des
tests statiques et un préflight réel sans téléchargement, conformément à la mission.

---

## 1. Fichiers livrés

Uniquement les trois fichiers autorisés :

- [`../scripts/generate_textured_3d.py`](../scripts/generate_textured_3d.py) — CLI Python complète.
- [`../scripts/generate_textured_3d.ps1`](../scripts/generate_textured_3d.ps1) — lanceur PowerShell.
- `docs/PHASE4_PRODUCTION_PIPELINE_WINDOWS.md` — ce document.

Aucun fichier source upstream de `hy3dgen` n'a été modifié (voir section 8, contrôle Git final).

---

## 2. Architecture

```
image d'entrée
     │
     ▼
[Préflight]  image valide, CUDA, custom_rasterizer_kernel, mesh_processor,
             disque, VRAM libre, RAM libre, aucun autre process Hunyuan actif,
             politique mémoire (seuils VRAM/RAM selon le mode)
     │
     ▼
[Shapegen]   Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(shape_model, subfolder=...)
             -> mesh brut -> shape-original.glb
             -> del shape_pipeline ; gc.collect() ; torch.cuda.empty_cache()
     │
     ▼
[Réduction]  FloaterRemover -> DegenerateFaceRemover -> FaceReducer(max_faces si dépassé)
             -> shape-reduced.glb
     │
     ├── --shape-only ──► [Validation GLB (géométrie uniquement)] ──► fin
     │
     ▼
[Texgen]     Hunyuan3DPaintPipeline.from_pretrained(texture_model, subfolder=...)
             si --low-vram : pipeline.enable_model_cpu_offload()  (jamais de .to("cuda") après)
             -> textured.glb
     │
     ▼
[Validation] trimesh + pygltflib : géométrie, sommets/faces > 0, matériau, texture, image
     │
     ▼
metadata.json + generation.log + résumé terminal + code de sortie
```

Le pipeline shape est toujours exécuté (il n'y a pas de mode « texture seule » dans ce script) ;
seul le passage en texture est conditionnel à l'absence de `--shape-only`. Le pipeline de texture
n'est **jamais importé** (ni chargé) lorsque `--shape-only` est utilisé — l'import
`from hy3dgen.texgen import Hunyuan3DPaintPipeline` est situé à l'intérieur de la fonction
`run_texgen`, qui n'est appelée que dans la branche non-`shape-only`.

---

## 3. Commandes

### Python direct

```powershell
.\.venv\Scripts\python.exe .\scripts\generate_textured_3d.py --help

.\.venv\Scripts\python.exe .\scripts\generate_textured_3d.py `
  --image assets\demo.png `
  --output-dir outputs\demo-shape-only `
  --shape-only

.\.venv\Scripts\python.exe .\scripts\generate_textured_3d.py `
  --image assets\demo.png `
  --output-dir outputs\demo-full `
  --low-vram
```

### Lanceur PowerShell (fonctionne depuis n'importe quel répertoire courant)

```powershell
powershell -ExecutionPolicy Bypass -File <repo-root>\scripts\generate_textured_3d.ps1 `
  -Image assets\demo.png -OutputDir outputs\demo-shape -ShapeOnly

powershell -ExecutionPolicy Bypass -File <repo-root>\scripts\generate_textured_3d.ps1 `
  -Image assets\demo.png -OutputDir outputs\demo-full -LowVram
```

Le lanceur résout `.venv\Scripts\python.exe` et `scripts\generate_textured_3d.py` par rapport à
`$PSScriptRoot` (l'emplacement du script `.ps1` lui-même), jamais par rapport au répertoire courant
(`$PWD`) — il peut donc être invoqué depuis n'importe quel dossier. Il ne modifie aucune variable
d'environnement ni configuration système, et propage tel quel le code de sortie du process Python
(`exit $LASTEXITCODE`).

---

## 4. Paramètres

| Paramètre CLI | Défaut | Rôle |
|---|---|---|
| `--image` | *(obligatoire)* | Image d'entrée (tout format lisible par Pillow) |
| `--output-dir` | *(obligatoire)* | Dossier du job (créé si absent) |
| `--seed` | `1234` | Graine du générateur (`torch.Generator(device="cuda").manual_seed(seed)`) |
| `--shape-steps` | `5` | `num_inference_steps` du pipeline shape |
| `--guidance-scale` | `5.0` | `guidance_scale` du pipeline shape |
| `--octree-resolution` | `256` | `octree_resolution` du pipeline shape |
| `--max-faces` | `40000` | Seuil de déclenchement de `FaceReducer` |
| `--shape-model` | `tencent/Hunyuan3D-2mini` | Dépôt HF du modèle de forme |
| `--shape-subfolder` | `hunyuan3d-dit-v2-mini-turbo` | Sous-dossier du modèle de forme |
| `--texture-model` | `tencent/Hunyuan3D-2` | Dépôt HF du modèle de texture |
| `--texture-subfolder` | `hunyuan3d-paint-v2-0-turbo` | Sous-dossier du modèle de texture |
| `--low-vram` | désactivé | Active `pipeline.enable_model_cpu_offload()` pour texgen |
| `--shape-only` | désactivé | S'arrête après la réduction, ne charge jamais texgen |
| `--overwrite` | désactivé | Autorise l'écrasement d'un `--output-dir` déjà peuplé |

Les modèles par défaut correspondent exactement à ceux déjà validés et mis en cache local lors des
Phases 3A (`tencent/Hunyuan3D-2mini` / `hunyuan3d-dit-v2-mini-turbo`) et 3B
(`tencent/Hunyuan3D-2` / `hunyuan3d-delight-v2-0` + `hunyuan3d-paint-v2-0-turbo`) : un premier run
réel avec les valeurs par défaut ne devrait déclencher aucun nouveau téléchargement.

---

## 5. Seuils mémoire (politique implémentée dans `apply_memory_policy`)

| Mode | VRAM libre requise | RAM libre requise |
|---|---|---|
| `--shape-only` | ≥ 6000 MiB, sinon refus (exit 2) | *(non vérifiée pour ce mode)* |
| Texture, `--low-vram` | ≥ 9500 MiB : OK immédiat | ≥ 12 Gio, sinon refus |
| Texture, `--low-vram`, 8500–9499 MiB | confirmation interactive `[y/N]` obligatoire (refus si stdin non interactif ou EOF) | ≥ 12 Gio, sinon refus |
| Texture, `--low-vram`, < 8500 MiB | refus (exit 2), aucun pipeline chargé | — |
| Texture, sans `--low-vram` | ≥ 11000 MiB (seuil conservateur, voir note) | ≥ 12 Gio, sinon refus |

**Note sur le seuil « sans `--low-vram` »** : la mission ne fixe un seuil chiffré que pour le cas
`--low-vram` (9500 / 8500 MiB, repris des Phases 3B/3C). Le cas texture *sans* CPU offload (tout le
pipeline reste sur GPU) n'est pas chiffré dans la mission ; `11000 MiB` a été choisi comme valeur
conservatrice par défaut du script (constante `TEXTURE_NO_LOW_VRAM_MIN_MIB`), en l'absence de
mesure réelle de ce mode sur cette carte 12 Go — **seul le mode `--low-vram` a été validé de bout en
bout** (Phase 3B/3C, pic réel 6,19 Gio réservés). Utiliser `--low-vram` est donc recommandé par
défaut sur cette machine.

Aucun processus n'est jamais tué automatiquement, à aucun seuil. Le préflight détecte aussi une
éventuelle autre instance de `generate_textured_3d.py` déjà active (recherche en lecture seule via
`psutil` sur la ligne de commande des processus Python) et refuse de démarrer si c'est le cas, sans
rien arrêter.

---

## 6. Structure des sorties

```
outputs\<job>\
  input.png            # copie de l'image d'entrée, toujours réencodée en PNG réel
  shape-original.glb    # mesh brut issu du pipeline shape (avant nettoyage/réduction)
  shape-reduced.glb     # après FloaterRemover + DegenerateFaceRemover + FaceReducer éventuel
  textured.glb          # absent si --shape-only
  metadata.json
  generation.log        # log complet (DEBUG), traceback incluse en cas d'échec
```

Tous les chemins de sortie passent par une fonction unique `output_path(job_dir, name)` qui
n'accepte qu'un nom de fichier appartenant à la liste fixe ci-dessus et vérifie que le chemin résolu
reste bien un enfant direct de `job_dir` — aucune écriture hors de ce dossier n'est possible depuis
ce script.

### `metadata.json`

Contient : date UTC, versions Python/PyTorch/CUDA, GPU, modèles + sous-dossiers utilisés, seed,
tous les paramètres CLI, durées (shapegen / réduction / texgen), sommets et faces avant/après
réduction et après texturation, pic VRAM (alloué/réservé, maximum toutes étapes confondues), taille
en octets de chaque fichier de sortie présent, résultat(s) de validation GLB, et le statut final.
**Aucune clé, jeton ou variable d'environnement n'y figure.**

---

## 7. Codes de sortie

| Code | Signification |
|---|---|
| `0` | Succès |
| `2` | Préflight bloquant (image invalide, CUDA absent, VRAM/RAM insuffisante, autre instance active, sortie déjà peuplée sans `--overwrite`, etc.) |
| `3` | Échec de la génération de forme (shapegen) |
| `4` | Échec de la réduction du maillage |
| `5` | Échec de la génération de texture (texgen) |
| `6` | Échec de la validation du GLB final |

`generation.log` contient toujours la traceback complète de l'exception ayant causé l'échec (niveau
DEBUG), même quand le terminal n'affiche qu'un message résumé (niveau INFO/ERROR). Toute la
mémoire CUDA du process est libérée dans un bloc `finally` global (`del` des meshes/pipelines,
`gc.collect()`, `torch.cuda.empty_cache()`), quel que soit le point d'échec.

---

## 8. Procédure de dépannage

- **Exit 2, « CUDA is not available »** : vérifier le driver NVIDIA et que le `.venv` utilisé est
  bien celui du dépôt (`.venv\Scripts\python.exe`, pas un interpréteur système).
- **Exit 2, VRAM/RAM insuffisante** : fermer des applications utilisant le GPU/la RAM et relancer —
  aucune fermeture automatique n'est effectuée par ce script.
- **Exit 2, « output directory already contains generated files »** : ajouter `--overwrite`, ou
  choisir un nouveau `--output-dir` (un nom de job différent est recommandé pour garder un
  historique).
- **Exit 2, « Another Hunyuan3D generation process appears to be running »** : vérifier
  `Get-Process python` / le Gestionnaire des tâches ; attendre la fin de l'autre run ou le fermer
  manuellement soi-même.
- **Exit 5 avec une erreur mentionnant `trust_remote_code` / `custom_pipeline`** : voir
  l'avertissement `diffusers` ci-dessous — l'environnement de ce dépôt doit rester sur
  `diffusers==0.37.1`.
- **Toute erreur inattendue** : consulter `outputs\<job>\generation.log` (traceback complète) avant
  de relancer.

### ⚠️ Avertissement `diffusers 0.37.1`

Cet environnement (`.venv`) utilise **`diffusers==0.37.1`**, installé volontairement en Phase 3B à
la place de la version 0.38.0 d'origine. Cause : le code upstream
`hy3dgen/texgen/utils/multiview_utils.py` charge un `custom_pipeline` local
(`hy3dgen/texgen/hunyuanpaint/pipeline.py`) sans `trust_remote_code=True`, ce que `diffusers>=0.38.0`
refuse désormais (avis de sécurité `GHSA-98h9-4798-4q5v` / `CVE-2026-44513`, corrigé dans la
`0.38.0`). Sans ce downgrade, **toute génération de texture échoue** avec une `ValueError` explicite
mentionnant `trust_remote_code`.

Conséquence pratique : cet environnement réintroduit sciemment cette vulnérabilité connue
(contournement de `trust_remote_code` pour les `custom_pipeline`/composants locaux). Risque jugé
acceptable ici car le seul `custom_pipeline` chargé par ce dépôt est un fichier local déjà présent
et audité (`hy3dgen/texgen/hunyuanpaint/pipeline.py`) — **mais ne pas réutiliser ce `.venv` pour
charger des `custom_pipeline` provenant de dépôts Hugging Face tiers non vérifiés.** Ne pas mettre
à niveau `diffusers` dans ce `.venv` sans revalider toute la chaîne de génération de texture.

---

## 9. Tests de validation effectués (section 11 de la mission — pas de génération lourde)

Aucune génération réelle complète n'a été relancée. Tests exécutés :

1. **`py_compile`** : `python -m py_compile scripts\generate_textured_3d.py` → exit 0.
2. **`--help`** : affiche la liste complète des 13 options attendues.
3. **Chemin d'image invalide** (`--image .\nope-does-not-exist.png --shape-only`) : échoue proprement
   en préflight, exit 2, message clair, `generation.log` écrit.
4. **Format d'image invalide** (fichier texte renommé `.png`) : échoue en préflight
   (`cannot identify image file`), exit 2.
5. **Refus d'écrasement** : `--output-dir` pré-rempli d'un faux `textured.glb`, sans `--overwrite` →
   refus immédiat avant même le préflight, exit 2, aucun fichier touché.
6. **Préflight réel sans téléchargement** : appel direct de `run_preflight()` avec l'image réelle
   `assets\demo.png` et `--shape-only` (arrêt volontaire avant `run_shapegen`, aucun modèle chargé) :
   image validée (PNG 500×500 RGBA), CUDA OK (RTX 4070 Ti), `custom_rasterizer_kernel` et
   `mesh_processor` importables, 141 Gio de disque libre, VRAM libre 9895 MiB, RAM libre 41,87 Gio,
   politique mémoire shape-only satisfaite. **Aucun téléchargement, aucun chargement de pipeline.**
7. **Tests unitaires de la politique mémoire** (`apply_memory_policy`, valeurs VRAM/RAM synthétiques,
   sans toucher au GPU réel) :
   - `--low-vram`, 9600 MiB libres → autorisé ;
   - `--low-vram`, 8600 MiB libres → zone de confirmation, refusé proprement (pas de TTY interactif
     réel disponible dans cet environnement, `EOFError` interceptée après correction — voir ci-dessous) ;
   - `--low-vram`, 8000 MiB libres → refusé (sous 8500 MiB) ;
   - `--low-vram`, 9600 MiB VRAM mais 5 Gio RAM → refusé (RAM insuffisante) ;
   - `--shape-only`, 6500 MiB → autorisé ; 5000 MiB → refusé ;
   - sans `--low-vram`, 11500 MiB → autorisé ; 10000 MiB → refusé.
   - **Bug détecté et corrigé pendant ces tests** : `sys.stdin.isatty()` retournait `True` dans cet
     environnement d'exécution sans qu'une véritable entrée interactive soit disponible, ce qui
     provoquait un `EOFError` non intercepté sur `input()` (crash au lieu d'un refus propre). Le code
     a été corrigé pour intercepter `EOFError`/`OSError` autour de `input()` et traiter ce cas comme
     « confirmation impossible » → refus avec exit 2, plutôt qu'un plantage.
8. **Validation statique** : aucun `os.environ` journalisé ; aucun appel `.to("cuda")` après
   `enable_model_cpu_offload()` (seule occurrence du mot-clé dans le fichier) ; import de
   `Hunyuan3DPaintPipeline` confiné à `run_texgen`, jamais appelée en mode `--shape-only`.
9. **Vérification Git** : voir section suivante.

Artéfacts de ces tests conservés dans `.verif\phase4-tests\` (scripts de test ad hoc, sorties de
préflight, dossiers de test d'écrasement/image invalide) — répertoire de vérification interne, pas
une sortie utilisateur (celles-ci vont sous `outputs\<job>\`).

---

## 10. Exemple shape-only (paramètres, pas d'exécution lourde relancée dans cette phase)

```powershell
.\.venv\Scripts\python.exe .\scripts\generate_textured_3d.py `
  --image assets\demo.png `
  --output-dir outputs\demo-shape-only `
  --shape-only `
  --seed 1234 --shape-steps 5 --octree-resolution 256 --max-faces 40000
```

Résultat attendu : `outputs\demo-shape-only\{input.png, shape-original.glb, shape-reduced.glb,
metadata.json, generation.log}` (pas de `textured.glb`), exit 0 si tout réussit.

## 11. Exemple complet low-vram

```powershell
.\.venv\Scripts\python.exe .\scripts\generate_textured_3d.py `
  --image assets\demo.png `
  --output-dir outputs\demo-full-lowvram `
  --low-vram `
  --seed 1234 --shape-steps 5 --octree-resolution 256 --max-faces 40000 `
  --texture-model tencent/Hunyuan3D-2 --texture-subfolder hunyuan3d-paint-v2-0-turbo
```

Résultat attendu : les six fichiers de sortie complets, `textured.glb` validé (matériau + texture +
image), exit 0 si tout réussit. **Cette exécution réelle nécessite une confirmation explicite de
l'utilisateur avant d'être lancée** (aucune génération lourde n'a été déclenchée automatiquement
dans le cadre de cette phase).

---

## 12. État Git final

```
git status --short
?? .verif/
?? docs/PHASE2B_CUSTOM_RASTERIZER_WINDOWS.md
?? docs/PHASE2C_CUDA_LIBRARIES_WINDOWS.md
?? docs/PHASE2_NATIVE_EXTENSIONS_WINDOWS.md
?? docs/PHASE3A_SHAPE_ONLY_GENERATION_WINDOWS.md
?? docs/PHASE3B_TEXTURED_GENERATION_WINDOWS.md
?? docs/PHASE4_PRODUCTION_PIPELINE_WINDOWS.md
?? docs/PREFLIGHT_WINDOWS.md
?? preflight_windows_output.txt
?? scripts/

git diff --stat
(vide)

git diff --check
(aucune sortie, exit code 0)
```

Aucun fichier source upstream de `hy3dgen` n'a été modifié. Seuls des fichiers nouveaux ont été
ajoutés (`scripts/generate_textured_3d.py`, `scripts/generate_textured_3d.ps1`, ce document, et des
artéfacts de test sous `.verif/phase4-tests/`). Aucun commit Git n'a été effectué.

---

## 13. Décision finale

## PRODUCTION_PIPELINE_READY

Le pipeline CLI (`generate_textured_3d.py` + `generate_textured_3d.ps1`) est écrit, compile
(`py_compile`), expose la CLI attendue (`--help` conforme), gère proprement les cas d'erreur testés
(image invalide, format invalide, refus d'écrasement, seuils mémoire dans les trois zones pour
`--shape-only`, texture `--low-vram` et texture sans `--low-vram`), passe un préflight réel sans
téléchargement ni chargement de pipeline, et respecte toutes les contraintes de sécurité demandées
(écriture confinée à `output_path()`, aucune variable d'environnement journalisée, logging avec
traceback conservée, libération CUDA en `finally`). Un bug d'environnement (`stdin.isatty()`
trompeur) a été détecté et corrigé pendant les tests avant validation finale.

Aucun fichier upstream modifié, aucun téléchargement de modèle effectué durant cette phase, aucune
génération lourde complète relancée, aucun Gradio/FastAPI/Blender lancé, aucun commit Git effectué.

**La première exécution réelle de bout en bout (avec téléchargement déjà en cache ou nouveau, selon
les modèles choisis) reste à confirmer explicitement par l'utilisateur avant d'être lancée.**