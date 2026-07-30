# Préflight Windows — Hunyuan3D-2 (Phase 1 : audit technique)

Ce document est un audit **en lecture seule** de l'environnement Windows local par rapport aux
exigences réelles du dépôt `Hunyuan3D-2`. Aucune installation, aucun téléchargement de modèle,
aucune compilation d'extension et aucune génération 3D n'ont été effectués pour produire ce
rapport. Les commandes exécutées sont uniquement des commandes de constat (`nvidia-smi`,
`pip list`, `Get-CimInstance`, `vswhere`, imports Python statiques, etc.).

Script associé : [`scripts/preflight_windows.ps1`](../scripts/preflight_windows.ps1) — reproduit
cet audit de façon automatisée et non destructive à tout moment. Il ne fait rien d'autre
qu'afficher des constats `OK` / `AVERTISSEMENT` / `BLOQUANT`.

Date de l'audit : 2026-07-30.

---

## 1. Structure du dépôt et points d'entrée

| Besoin                                   | Point d'entrée                                                                                 |
|-------------------------------------------|-------------------------------------------------------------------------------------------------|
| Image → mesh nu (sans texture)            | `hy3dgen.shapegen.Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(...)` (voir `README.md`, `minimal_demo.py`, `examples/shape_gen*.py`) |
| Image → mesh texturé (PBR/albedo)         | `hy3dgen.shapegen...` puis `hy3dgen.texgen.Hunyuan3DPaintPipeline.from_pretrained(...)` (voir `examples/textured_shape_gen*.py`) |
| Interface Gradio                          | `python3 gradio_app.py --model_path <repo> --subfolder <sous-dossier> --texgen_model_path tencent/Hunyuan3D-2 [--low_vram_mode] [--enable_flashvdm]` |
| Serveur API FastAPI                       | `python api_server.py --host 0.0.0.0 --port 8080` → route `POST /generate` (voir `api_server.py:244`) |
| Addon Blender                             | `blender_addon.py`, client HTTP de l'API server (`http://localhost:8080` par défaut, `blender_addon.py:43`) — nécessite le serveur API déjà lancé |

Installation documentée (README.md:175-186) :
```
pip install -r requirements.txt
pip install -e .
cd hy3dgen/texgen/custom_rasterizer && python3 setup.py install && cd ../../..
cd hy3dgen/texgen/differentiable_renderer && python3 setup.py install
```

Extensions natives :
- `hy3dgen/texgen/custom_rasterizer/` : extension **CUDA** (`torch.utils.cpp_extension.CUDAExtension`,
  `setup.py`), compile `rasterizer.cpp`, `grid_neighbor.cpp` et `rasterizer_gpu.cu`. Nécessite **nvcc**.
  Pas de gestion différenciée par plateforme dans son `setup.py` (contrairement à l'autre extension).
- `hy3dgen/texgen/differentiable_renderer/` : extension **C++ pur** (`pybind11`, `setuptools.Extension`),
  compile `mesh_processor.cpp`. Son `setup.py` gère explicitement Windows (`/O2 /std:c++14 /EHsc /MP
  /bigobj` pour MSVC) — ne nécessite **pas** nvcc, seulement un compilateur C++.
  Un script alternatif `compile_mesh_painter.bat` existe mais est codé en dur pour g++ et Python 3.12
  (`-lpython3.12`) : à ignorer sur cette machine (Python 3.13, MSVC), le `setup.py` standard est le
  chemin à utiliser.
- Aucun `CMakeLists.txt` dans le dépôt : CMake **n'est pas requis**, malgré sa présence habituelle
  dans ce type de projet.

`hy3dgen/texgen/pipelines.py` importe `custom_rasterizer` de façon paresseuse (à l'intérieur des
méthodes de rendu, pas au niveau du module) — vérifié par import statique : `from hy3dgen.texgen
import Hunyuan3DPaintPipeline` réussit même sans l'extension compilée. L'échec ne surviendrait
qu'au moment réel du rendu/bake de texture.

---

## 2. Matériel et logiciels détectés

| Élément                     | Valeur détectée                                                                 |
|------------------------------|-----------------------------------------------------------------------------------|
| OS                           | Windows 11 Professionnel, build 26200, 64 bits                                   |
| PowerShell                   | 5.1.26100.8972 (Desktop)                                                          |
| GPU                          | NVIDIA GeForce RTX 4070 Ti — 12 282 MiB (~12 GB) VRAM totale (source : `nvidia-smi`) |
| VRAM libre au moment de l'audit | ~1,8 GB seulement — un processus `python.exe` tiers (PID 3700, hors dépôt) et divers process compositeur occupaient déjà ~10,2 GB |
| Pilote NVIDIA                | 591.86                                                                             |
| CUDA (niveau pilote)         | 13.1 (capacité max supportée par le pilote, pas une installation de toolkit)      |
| nvcc / CUDA Toolkit          | **Absent** — aucune installation sous `Program Files\NVIDIA GPU Computing Toolkit`, `CUDA_PATH` non défini |
| CMake                        | Absent — sans impact, non requis par ce dépôt                                    |
| Compilateur MSVC             | Visual Studio Build Tools 2022 présent, composant `VC.Tools.x86.x64`, toolset `14.44.35207`, Windows SDK `10.0.26100.0` — `cl.exe` pas sur le PATH directement (nécessite un shell "Developer Command Prompt/PowerShell for VS 2022" ou `vcvarsall.bat`) |
| Python (global)              | 3.13.12 — `C:\Python313\python.exe`                                              |
| pip (global)                 | 26.1.2                                                                             |
| venv du projet               | `.venv/` déjà présent à la racine du dépôt, créé avec `--system-site-packages` depuis `C:\Python313`, Python 3.13.12 |
| Conda                        | Absent — sans impact, venv standard utilisable                                   |
| Git                          | 2.55.0.windows.3                                                                   |
| Git LFS                      | 3.7.1                                                                              |
| Espace disque (C:, dépôt + profil utilisateur) | 166,6 GB libres                                                  |
| Autres disques                | D: 1374,1 GB libres, F: 14,7 GB libres, G: 30,3 GB libres                        |
| Cache modèles par défaut      | `%USERPROFILE%\.cache\hy3dgen` (n'existe pas encore) — override possible via `HY3DGEN_MODELS` |

Note : `Get-CimInstance Win32_VideoController` rapporte `AdapterRAM` = ~4 GB pour la RTX 4070 Ti,
ce qui est **faux** (limite connue d'un champ WMI 32 bits pour les cartes récentes >4GB). La valeur
fiable utilisée dans ce rapport vient de `nvidia-smi` (12 GB).

---

## 3. Environnement Python déjà installé dans `.venv`

`.venv` existe déjà et `hy3dgen` y est installé en mode éditable (`pip install -e .` déjà fait).
État constaté (`pip list`) :

| Paquet          | Version installée | Contrainte du dépôt                  | Constat |
|------------------|--------------------|----------------------------------------|---------|
| torch            | 2.6.0+cu124        | non pinné (README renvoie vers pytorch.org) | OK, CUDA disponible (`torch.cuda.is_available() == True`) |
| torchvision      | 0.21.0+cu124       | non pinné                              | OK |
| transformers     | 5.9.0               | `>=4.48.0` (setup.py)                  | **Écart majeur** : la contrainte n'a qu'un plancher ; la v5 majeure installée peut contenir des ruptures d'API par rapport à ce qui a été testé par les auteurs (probablement 4.x). À surveiller à l'exécution réelle des pipelines. |
| diffusers        | 0.38.0              | non pinné                              | À surveiller de même |
| gradio           | 6.21.0               | non pinné                              | Écart de version majeure probable vs l'époque d'écriture de `gradio_app.py` (janv. 2025) — risque de rupture d'API Gradio pour l'app, pas pour le cœur `hy3dgen` |
| numpy            | 2.4.6                | non pinné                              | NumPy 2.x — a priori compatible ici (rien n'a échoué à l'installation), à confirmer à l'exécution |
| onnxruntime, xatlas, pymeshlab, pygltflib, trimesh, opencv-python, accelerate, einops, omegaconf, fastapi, uvicorn, rembg | installés | listés dans `requirements.txt`/`setup.py` | Tous présents |
| custom_rasterizer | **non installé**   | extension native requise pour la texture | Attendu à ce stade (pas encore compilée) |
| mesh_processor    | **non installé**   | extension native requise pour la texture | Attendu à ce stade (pas encore compilée) |

Import statique vérifié sans réseau (`HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1`) :
`hy3dgen.shapegen.Hunyuan3DDiTFlowMatchingPipeline`, `hy3dgen.rembg.BackgroundRemover` et
`hy3dgen.texgen.Hunyuan3DPaintPipeline` s'importent tous les trois sans erreur avec Python 3.13.12
et les versions ci-dessus. Cela ne garantit pas l'absence de rupture au runtime réel (chargement
de poids, appels d'API internes de `transformers`/`diffusers`), mais élimine déjà les problèmes
d'import/de dépendances manquantes les plus basiques.

**Aucune version Python minimale n'est déclarée nulle part dans le dépôt** (pas de
`python_requires` dans `setup.py`, rien dans le README). Le fait que tout l'ensemble de
dépendances (y compris `pymeshlab`, `onnxruntime`, `xatlas`, dont les wheels Windows tardent
parfois à suivre les nouvelles versions de Python) se soit installé et importe correctement sous
Python 3.13.12 est une confirmation empirique de compatibilité, pas une garantie éditeur.

---

## 4. Comparaison exigences ↔ environnement détecté

| Exigence (dépôt)                                             | Détecté                          | Verdict |
|----------------------------------------------------------------|-----------------------------------|---------|
| GPU CUDA, 6 GB VRAM mini pour shape seul (README.md:126)       | RTX 4070 Ti, 12 GB                | OK |
| GPU CUDA, 16 GB VRAM pour shape+texture (README.md:126)        | RTX 4070 Ti, 12 GB                | **Insuffisant** en pipeline complet non optimisé — utiliser `--low_vram_mode` et/ou les variantes `mini`/`turbo` documentées dans le README (offload CPU du modèle de texture) |
| VRAM réellement disponible au moment présent                   | ~1,8 GB libres (GPU partagé avec d'autres apps) | À libérer avant toute génération réelle |
| Compilateur pour `custom_rasterizer` (CUDAExtension → nvcc)    | nvcc absent                       | **Bloquant** pour cette extension précise |
| Compilateur pour `mesh_processor` (pybind11/C++ pur)           | MSVC 14.44 + SDK présents         | OK |
| Support plateforme (README.md:165 : "Macos, Windows, Linux")   | Windows 11                        | OK, supporté officiellement |
| `transformers>=4.48.0` (setup.py)                              | 5.9.0 installé                    | Plancher respecté, mais saut de version majeure non testé par les auteurs — risque runtime, pas un blocage d'installation |
| Espace disque pour dépendances + modèles                       | 166,6 GB libres sur C:            | Largement suffisant (estimation détaillée section 5) |
| Git / Git LFS pour cloner/mettre à jour                        | présents                          | OK |

---

## 5. Estimation de l'espace disque nécessaire

Ordres de grandeur d'après les tailles de modèles annoncées dans le README (colonne "Size", en
paramètres, converties approximativement en poids sur disque en précision courante) :

- Modèle shape (mini 0.6B → full 3B selon la variante) : de l'ordre de **2 à 6 GB** par variante.
- Modèle texture (delight + paint, 1.3B chacun) : de l'ordre de **3 à 6 GB** au total par variante
  (standard ou turbo).
- Dépendances Python déjà installées dans `.venv` (torch+cu124, transformers, diffusers, etc.) :
  déjà comptabilisées, de l'ordre de **6 à 8 GB** occupés par le venv actuel.
- Cache Hugging Face additionnel si plusieurs variantes de modèles sont testées (mini, mv, standard,
  turbo) : possibilité de cumuler **15 à 30 GB** si tout le "model zoo" est téléchargé.

**Estimation totale raisonnable pour une utilisation complète (une variante shape + une variante
texture + dépendances) : 15-20 GB. Pour tester l'ensemble du model zoo documenté : jusqu'à ~40 GB.**
Avec 166,6 GB libres sur C:, la marge est large dans les deux cas.

---

## 6. Faisabilité Windows natif vs WSL2

**Recommandation : Windows natif, pas de WSL2 nécessaire.**

Justification :
- Le README annonce explicitement le support Windows.
- `torch` avec CUDA fonctionne déjà nativement sur cette machine (`torch.cuda.is_available() ==
  True`, GPU détecté).
- Le compilateur C++ (MSVC) est déjà installé et suffit pour l'une des deux extensions natives.
- `differentiable_renderer/setup.py` gère explicitement les flags MSVC pour Windows — le dépôt a
  été pensé pour compiler nativement sous Windows, pas seulement sous Linux/WSL.
- Le seul vrai manque est le CUDA Toolkit (`nvcc`) pour `custom_rasterizer`, qui s'installe
  nativement sous Windows (installateur NVIDIA officiel) sans passer par WSL2.

WSL2 ne serait à envisager que si l'installation native du CUDA Toolkit posait un problème
persistant, ou par préférence pour un environnement Linux plus proche de celui des auteurs — ce
n'est pas une nécessité technique ici.

---

## 7. Risques de compilation identifiés

1. **`custom_rasterizer` (bloquant tant que non résolu)** : nécessite `nvcc`, absent. De plus son
   `setup.py` ne fixe aucun flag de compilation spécifique à Windows (contrairement à
   `differentiable_renderer/setup.py`) — une fois `nvcc` installé, il n'est pas garanti que la
   compilation MSVC + nvcc passe sans ajustement (source d'erreurs fréquentes avec
   `CUDAExtension` sous Windows : version de MSVC trop récente non supportée par certaines versions
   de CUDA Toolkit, chemins avec espaces, etc.). À vérifier concrètement en Phase 2.
2. **Alignement des versions CUDA** : le pilote supporte jusqu'à CUDA 13.1, `torch` embarque le
   runtime CUDA 12.4 (`torch.version.cuda == '12.4'`). Pour compiler une extension CUDA compatible,
   la version du CUDA Toolkit installée doit être cohérente avec celle utilisée par `torch` (viser
   une CUDA Toolkit 12.4.x, pas forcément la toute dernière 13.x).
3. **`compile_mesh_painter.bat`** est un script alternatif obsolète (g++, Python 3.12 codé en dur) :
   ne pas l'utiliser sur cette machine ; utiliser `setup.py install` normal qui gère MSVC/Python 3.13.
4. **VRAM déjà partiellement occupée** : ~10 GB déjà utilisés par d'autres processus au moment de
   l'audit ; aucune compilation n'est affectée par cela, mais toute exécution réelle des pipelines
   nécessitera de libérer de la VRAM au préalable.

---

## 8. Fichiers créés

- `docs/PREFLIGHT_WINDOWS.md` (ce document)
- `scripts/preflight_windows.ps1` (audit automatisé, lecture seule, ré-exécutable à tout moment)

Aucun autre fichier du dépôt n'a été modifié. `CLAUDE.md` n'a nécessité aucune correction.

---

## 9. Commandes proposées pour la Phase 2 (non exécutées)

À valider avant exécution — installation de paquets, téléchargement du CUDA Toolkit, compilation
des extensions :

```bash
# 1. Installer les dépendances Python restantes déjà listées dans requirements.txt
#    (la plupart sont déjà présentes dans .venv, à revalider après activation)
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pip install -e .

# 2. Installer un CUDA Toolkit 12.4.x (aligné avec torch.version.cuda == '12.4')
#    via l'installateur officiel NVIDIA (hors scope de ce script en lecture seule) :
#    https://developer.nvidia.com/cuda-12-4-0-download-archive
#    Vérification ensuite :
nvcc --version

# 3. Compiler l'extension CUDA (nécessite nvcc + MSVC, depuis un shell "Developer PowerShell for VS 2022")
cd hy3dgen\texgen\custom_rasterizer
python setup.py install
cd ..\..\..

# 4. Compiler l'extension C++ pure (MSVC seul, pas besoin de nvcc)
cd hy3dgen\texgen\differentiable_renderer
python setup.py install
cd ..\..\..

# 5. Vérification post-compilation (import uniquement, pas de génération)
python -c "import custom_rasterizer; import mesh_processor; print('extensions OK')"

# 6. Premier test réel (télécharge les poids depuis Hugging Face au premier appel)
python minimal_demo.py
```

---

## 10. Décision finale

## READY_WITH_WARNINGS

Le socle Windows natif est globalement prêt : GPU NVIDIA CUDA détecté et fonctionnel sous `torch`,
compilateur MSVC opérationnel, Python/pip/`venv`/Git en place, dépendances Python quasi toutes déjà
installées, espace disque très largement suffisant. Le dépôt est explicitement conçu pour tourner
sous Windows natif — aucune bascule vers WSL2 n'est nécessaire.

Deux points empêchent de déclarer un `READY` complet :
- **CUDA Toolkit (`nvcc`) absent** → bloque à ce jour la compilation de `custom_rasterizer`, donc
  la génération de texture. La génération de mesh nu (shape seul) n'est pas affectée.
- **VRAM totale (12 GB) inférieure aux 16 GB recommandés** pour le pipeline shape+texture complet
  → gérable via `--low_vram_mode` et les variantes `mini`/`turbo` déjà prévues par le projet, mais
  à garder en tête pour le choix des modèles en Phase 2.

Aucun de ces points ne constitue un blocage définitif : les deux se résolvent par une installation
standard (CUDA Toolkit) et par les options déjà documentées par les auteurs (mode VRAM basse), sans
contourner le code source ni modifier le dépôt.
