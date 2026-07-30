<#
.SYNOPSIS
    Audit Windows en lecture seule pour la preparation de Hunyuan3D-2.

.DESCRIPTION
    Ce script n'installe rien, ne telecharge rien, ne compile rien et ne modifie
    aucune configuration systeme. Il se contente d'interroger l'environnement
    local (OS, GPU, pilotes, outils de compilation, Python, disque) et de
    comparer ce qui est detecte aux exigences connues du depot Hunyuan3D-2
    (requirements.txt, setup.py, hy3dgen/texgen/*/setup.py, README.md).

    Chaque verification affiche un statut : OK, AVERTISSEMENT ou BLOQUANT.
    Le code de sortie du script n'est different de 0 que si au moins un
    BLOQUANT reel a ete detecte (ex : Python absent, aucun GPU NVIDIA,
    espace disque insuffisant).

.NOTES
    Usage : powershell -ExecutionPolicy Bypass -File scripts\preflight_windows.ps1
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
$script:BlockingCount = 0
$script:WarningCount = 0
$script:OkCount = 0
$script:Results = New-Object System.Collections.Generic.List[object]

function Write-Check {
    param(
        [Parameter(Mandatory)] [string]$Section,
        [Parameter(Mandatory)] [ValidateSet('OK', 'AVERTISSEMENT', 'BLOQUANT')] [string]$Status,
        [Parameter(Mandatory)] [string]$Message,
        [string]$Detail = ''
    )

    switch ($Status) {
        'OK'             { $color = 'Green';  $script:OkCount++ }
        'AVERTISSEMENT'  { $color = 'Yellow'; $script:WarningCount++ }
        'BLOQUANT'       { $color = 'Red';    $script:BlockingCount++ }
    }

    $line = "[{0,-13}] {1,-28} {2}" -f $Status, $Section, $Message
    Write-Host $line -ForegroundColor $color
    if ($Detail) {
        Write-Host ("                 -> {0}" -f $Detail) -ForegroundColor DarkGray
    }

    $script:Results.Add([PSCustomObject]@{
        Section = $Section
        Status  = $Status
        Message = $Message
        Detail  = $Detail
    })
}

function Test-CommandExists {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

Write-Host ""
Write-Host "=== Preflight Windows - Hunyuan3D-2 (lecture seule) ===" -ForegroundColor Cyan
Write-Host "Aucune installation, aucun telechargement, aucune compilation n'est effectue par ce script." -ForegroundColor Cyan
Write-Host ""

# Racine du depot = dossier parent de scripts\
$RepoRoot = Split-Path -Parent $PSScriptRoot

# ---------------------------------------------------------------------------
# 1. Systeme d'exploitation
# ---------------------------------------------------------------------------
try {
    $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
    $osDetail = "{0} (build {1}, {2})" -f $os.Caption, $os.BuildNumber, $os.OSArchitecture
    if ($os.Caption -match 'Windows') {
        Write-Check -Section 'Systeme (OS)' -Status 'OK' -Message $os.Caption -Detail $osDetail
    } else {
        Write-Check -Section 'Systeme (OS)' -Status 'BLOQUANT' -Message 'OS non Windows detecte' -Detail $osDetail
    }
} catch {
    Write-Check -Section 'Systeme (OS)' -Status 'AVERTISSEMENT' -Message 'Impossible de determiner la version Windows' -Detail $_.Exception.Message
}

# ---------------------------------------------------------------------------
# 2. PowerShell
# ---------------------------------------------------------------------------
$psVersion = $PSVersionTable.PSVersion
if ($psVersion.Major -ge 5) {
    Write-Check -Section 'PowerShell' -Status 'OK' -Message "$psVersion" -Detail "Edition: $($PSVersionTable.PSEdition)"
} else {
    Write-Check -Section 'PowerShell' -Status 'AVERTISSEMENT' -Message "$psVersion (ancien)" -Detail 'PowerShell 5.1+ recommande'
}

# ---------------------------------------------------------------------------
# 3. GPU NVIDIA + VRAM (source de verite : nvidia-smi, pas WMI)
# ---------------------------------------------------------------------------
$nvidiaSmiPath = Get-Command 'nvidia-smi' -ErrorAction SilentlyContinue
$gpuTotalMiB = $null
$gpuFreeMiB = $null
$driverVersion = $null
$cudaDriverVersion = $null

if ($nvidiaSmiPath) {
    try {
        $raw = & nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free,driver_version --format=csv,noheader 2>$null
        if ($raw) {
            $first = ($raw -split "`n")[0].Trim()
            $parts = $first -split ',\s*'
            $gpuName = $parts[0]
            $gpuTotalMiB = [int]($parts[1] -replace '[^\d]', '')
            $gpuUsedMiB  = [int]($parts[2] -replace '[^\d]', '')
            $gpuFreeMiB  = [int]($parts[3] -replace '[^\d]', '')
            $driverVersion = $parts[4]

            $cudaLine = (& nvidia-smi 2>$null | Select-String 'CUDA Version:')
            if ($cudaLine) {
                if ($cudaLine.Line -match 'CUDA Version:\s*([\d\.]+)') {
                    $cudaDriverVersion = $Matches[1]
                }
            }

            $gpuTotalGB = [math]::Round($gpuTotalMiB / 1024, 1)
            $gpuFreeGB  = [math]::Round($gpuFreeMiB / 1024, 1)
            $detail = "$gpuName | VRAM totale: ${gpuTotalGB} GB | VRAM libre actuellement: ${gpuFreeGB} GB | Pilote: $driverVersion | CUDA (pilote): $cudaDriverVersion"

            if ($gpuTotalMiB -lt 6 * 1024) {
                Write-Check -Section 'GPU NVIDIA' -Status 'BLOQUANT' -Message 'VRAM insuffisante (< 6 GB)' -Detail $detail
            } elseif ($gpuTotalMiB -lt 16 * 1024) {
                Write-Check -Section 'GPU NVIDIA' -Status 'AVERTISSEMENT' -Message 'VRAM suffisante pour shape seul (6GB), insuffisante pour shape+texture (16GB recommande par le README)' -Detail $detail
            } else {
                Write-Check -Section 'GPU NVIDIA' -Status 'OK' -Message 'VRAM suffisante pour shape+texture' -Detail $detail
            }

            if ($gpuFreeMiB -lt 4 * 1024) {
                Write-Check -Section 'GPU NVIDIA (VRAM libre)' -Status 'AVERTISSEMENT' -Message "Peu de VRAM libre actuellement (${gpuFreeGB} GB)" -Detail 'D''autres processus occupent le GPU au moment de l''audit ; fermez-les avant une generation lourde.'
            } else {
                Write-Check -Section 'GPU NVIDIA (VRAM libre)' -Status 'OK' -Message "${gpuFreeGB} GB libres actuellement" -Detail ''
            }
        } else {
            Write-Check -Section 'GPU NVIDIA' -Status 'BLOQUANT' -Message 'nvidia-smi present mais aucune sortie exploitable' -Detail ''
        }
    } catch {
        Write-Check -Section 'GPU NVIDIA' -Status 'BLOQUANT' -Message 'Erreur lors de l''appel a nvidia-smi' -Detail $_.Exception.Message
    }
} else {
    Write-Check -Section 'GPU NVIDIA' -Status 'BLOQUANT' -Message 'nvidia-smi introuvable (pas de GPU NVIDIA / pilote non installe)' -Detail 'Hunyuan3D-2 necessite un GPU NVIDIA CUDA pour une inference raisonnable.'
}

# ---------------------------------------------------------------------------
# 4. CUDA Toolkit (nvcc) - requis pour compiler custom_rasterizer (extension .cu)
#
#    nvcc n'est volontairement PAS ajoute au PATH par l'installation en place
#    (cf. docs/PREFLIGHT_WINDOWS.md). La detection suit donc un ordre de
#    repli explicite, sans jamais modifier PATH ni aucune variable systeme :
#      1. Get-Command nvcc.exe (au cas ou le PATH le referencerait deja)
#      2. $env:CUDA_PATH\bin\nvcc.exe (variable de la session courante)
#      3. CUDA_PATH au niveau Machine (registre / variables systeme)
#      4. CUDA_PATH_V12_4 au niveau Machine
#      5. Chemin standard d'installation NVIDIA pour CUDA 12.4
# ---------------------------------------------------------------------------
function Find-Nvcc {
    $cmd = Get-Command 'nvcc.exe' -ErrorAction SilentlyContinue
    if (-not $cmd) { $cmd = Get-Command 'nvcc' -ErrorAction SilentlyContinue }
    if ($cmd) {
        return [PSCustomObject]@{ Path = $cmd.Source; Method = 'Get-Command nvcc.exe (PATH du terminal courant)' }
    }

    if ($env:CUDA_PATH) {
        $candidate = Join-Path $env:CUDA_PATH 'bin\nvcc.exe'
        if (Test-Path $candidate) {
            return [PSCustomObject]@{ Path = $candidate; Method = '$env:CUDA_PATH (variable de la session courante)' }
        }
    }

    $machineCudaPath = [System.Environment]::GetEnvironmentVariable('CUDA_PATH', 'Machine')
    if ($machineCudaPath) {
        $candidate = Join-Path $machineCudaPath 'bin\nvcc.exe'
        if (Test-Path $candidate) {
            return [PSCustomObject]@{ Path = $candidate; Method = 'CUDA_PATH (niveau Machine)' }
        }
    }

    $machineCudaPathV124 = [System.Environment]::GetEnvironmentVariable('CUDA_PATH_V12_4', 'Machine')
    if ($machineCudaPathV124) {
        $candidate = Join-Path $machineCudaPathV124 'bin\nvcc.exe'
        if (Test-Path $candidate) {
            return [PSCustomObject]@{ Path = $candidate; Method = 'CUDA_PATH_V12_4 (niveau Machine)' }
        }
    }

    $standardPath = 'C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4\bin\nvcc.exe'
    if (Test-Path $standardPath) {
        return [PSCustomObject]@{ Path = $standardPath; Method = 'Chemin standard NVIDIA (repli final)' }
    }

    return $null
}

$nvccInfo = Find-Nvcc
if ($nvccInfo) {
    try {
        $nvccOut = & $nvccInfo.Path --version 2>$null
        $verLine = ($nvccOut | Select-String 'release').Line
        Write-Check -Section 'CUDA Toolkit (nvcc)' -Status 'OK' -Message "nvcc detecte via: $($nvccInfo.Method)" -Detail "Chemin exact: $($nvccInfo.Path) | $verLine"
    } catch {
        Write-Check -Section 'CUDA Toolkit (nvcc)' -Status 'AVERTISSEMENT' -Message 'nvcc trouve mais "nvcc --version" a echoue' -Detail "Chemin: $($nvccInfo.Path) (via $($nvccInfo.Method)) | $($_.Exception.Message)"
    }
} else {
    Write-Check -Section 'CUDA Toolkit (nvcc)' -Status 'BLOQUANT' -Message 'nvcc introuvable (PATH, $env:CUDA_PATH, CUDA_PATH/CUDA_PATH_V12_4 machine, chemin standard)' -Detail 'Requis pour compiler hy3dgen/texgen/custom_rasterizer (CUDAExtension). Le pilote GPU seul ne suffit pas : il faut le CUDA Toolkit (nvcc) installe separement, idealement une version alignee avec torch.version.cuda.'
}

# ---------------------------------------------------------------------------
# 4bis. Completude du CUDA Toolkit vis-a-vis des headers exiges par PyTorch
#       (ATen/cuda/CUDAContextLight.h inclut inconditionnellement cusparse.h,
#       cublas_v2.h, cublasLt.h et cusolverDn.h - meme si custom_rasterizer
#       n'utilise directement aucune de ces bibliotheques). Verification en
#       lecture seule uniquement : aucun fichier n'est copie, telecharge ou
#       installe ici.
#
#       Trois etats possibles :
#         - CUDA_TOOLKIT_COMPILER_ONLY      : nvcc present mais aucun des 4
#                                              headers ATen n'est present
#                                              (etat observe en Phase 2A/2B)
#         - CUDA_TOOLKIT_ATEN_HEADERS_READY : nvcc + les 4 headers + les 4 libs
#                                              sont tous presents
#         - CUDA_TOOLKIT_INCOMPLETE         : etat mixte (certains presents,
#                                              d'autres non) ou nvcc absent
# ---------------------------------------------------------------------------
$atenHeaderLibPairs = @(
    @{ Header = 'include\cusparse.h';   Lib = 'lib\x64\cusparse.lib';   Name = 'cuSPARSE' },
    @{ Header = 'include\cublas_v2.h';  Lib = 'lib\x64\cublas.lib';     Name = 'cuBLAS' },
    @{ Header = 'include\cublasLt.h';   Lib = 'lib\x64\cublasLt.lib';   Name = 'cuBLASLt' },
    @{ Header = 'include\cusolverDn.h'; Lib = 'lib\x64\cusolver.lib';   Name = 'cuSOLVER' }
)

# Racine du Toolkit : deduite de nvcc si trouve (deux niveaux au-dessus de bin\nvcc.exe),
# sinon repli sur CUDA_PATH (Machine), sans jamais rien modifier.
$cudaToolkitRoot = $null
if ($nvccInfo) {
    $cudaToolkitRoot = Split-Path -Parent (Split-Path -Parent $nvccInfo.Path)
} else {
    $cudaToolkitRoot = [System.Environment]::GetEnvironmentVariable('CUDA_PATH', 'Machine')
}

if ($cudaToolkitRoot) {
    $presence = foreach ($pair in $atenHeaderLibPairs) {
        $headerPath = Join-Path $cudaToolkitRoot $pair.Header
        $libPath = Join-Path $cudaToolkitRoot $pair.Lib
        [PSCustomObject]@{
            Name        = $pair.Name
            HeaderOk    = Test-Path $headerPath
            LibOk       = Test-Path $libPath
            HeaderPath  = $headerPath
            LibPath     = $libPath
        }
    }

    $allPresent = -not ($presence | Where-Object { -not $_.HeaderOk -or -not $_.LibOk })
    $nonePresent = -not ($presence | Where-Object { $_.HeaderOk -or $_.LibOk })
    $detailLines = ($presence | ForEach-Object {
        $hStatus = if ($_.HeaderOk) { 'PRESENT' } else { 'ABSENT' }
        $lStatus = if ($_.LibOk) { 'PRESENT' } else { 'ABSENT' }
        "$($_.Name): header=$hStatus lib=$lStatus"
    }) -join ' | '

    if ($nvccInfo -and $allPresent) {
        Write-Check -Section 'CUDA Toolkit (headers ATen/PyTorch)' -Status 'OK' -Message 'CUDA_TOOLKIT_ATEN_HEADERS_READY' -Detail $detailLines
    } elseif ($nvccInfo -and $nonePresent) {
        Write-Check -Section 'CUDA Toolkit (headers ATen/PyTorch)' -Status 'AVERTISSEMENT' -Message 'CUDA_TOOLKIT_COMPILER_ONLY (nvcc seul, cuSPARSE/cuBLAS/cuBLASLt/cuSOLVER absents)' -Detail "$detailLines | Requis pour compiler custom_rasterizer (rasterizer_gpu.cu inclut torch/ATen/cuda/CUDAContextLight.h, qui inclut ces 4 headers)."
    } else {
        Write-Check -Section 'CUDA Toolkit (headers ATen/PyTorch)' -Status 'AVERTISSEMENT' -Message 'CUDA_TOOLKIT_INCOMPLETE (etat mixte ou nvcc absent)' -Detail $detailLines
    }
} else {
    Write-Check -Section 'CUDA Toolkit (headers ATen/PyTorch)' -Status 'AVERTISSEMENT' -Message 'CUDA_TOOLKIT_INCOMPLETE (racine du Toolkit indeterminee, nvcc introuvable)' -Detail ''
}

# ---------------------------------------------------------------------------
# 5. Compilateur C++ MSVC (Visual Studio Build Tools) - requis pour
#    differentiable_renderer/mesh_processor et la partie .cpp de custom_rasterizer
#
#    Trois etats distincts sont rapportes (aucun n'est traite comme "pret a
#    compiler" tant que cl.exe n'est pas reellement utilisable dans le
#    terminal courant AVEC les variables INCLUDE/LIB positionnees par
#    vcvarsall.bat) :
#      - OK            : cl.exe sur le PATH courant ET INCLUDE/LIB definis
#      - AVERTISSEMENT : VS Build Tools installe mais environnement dev non
#                         active dans ce terminal (cl.exe absent du PATH, ou
#                         present sans INCLUDE/LIB)
#      - BLOQUANT       : aucune installation Visual Studio avec le
#                         composant Desktop C++ trouvee
# ---------------------------------------------------------------------------
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$msvcInstalled = $false
$vsPath = $null
$toolsVersion = $null
if (Test-Path $vswhere) {
    try {
        $vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
        if ($vsPath) {
            $msvcInstalled = $true
            $toolsRoot = Join-Path $vsPath 'VC\Tools\MSVC'
            $toolsVersion = if (Test-Path $toolsRoot) { (Get-ChildItem $toolsRoot -ErrorAction SilentlyContinue | Select-Object -First 1).Name } else { 'inconnue' }
        }
    } catch {
        # vswhere absent d'erreur -> $msvcInstalled reste false, traite plus bas
    }
}

$clCmd = Get-Command 'cl.exe' -ErrorAction SilentlyContinue
$clOnPath = [bool]$clCmd
$devEnvVarsSet = [bool]$env:INCLUDE -and [bool]$env:LIB
$devEnvFullyActive = $clOnPath -and $devEnvVarsSet

if ($devEnvFullyActive) {
    Write-Check -Section 'Compilateur C++ (MSVC)' -Status 'OK' -Message 'cl.exe utilisable dans ce terminal (INCLUDE et LIB definis)' -Detail "cl.exe: $($clCmd.Source) | Installation VS: $vsPath | Toolset MSVC: $toolsVersion"
} elseif ($clOnPath) {
    Write-Check -Section 'Compilateur C++ (MSVC)' -Status 'AVERTISSEMENT' -Message 'cl.exe trouve sur le PATH mais INCLUDE/LIB non definis dans ce terminal' -Detail "cl.exe: $($clCmd.Source) | vcvarsall.bat ne semble pas avoir ete execute dans cette session. Ouvrir 'Developer PowerShell for VS 2022' avant de compiler."
} elseif ($msvcInstalled) {
    Write-Check -Section 'Compilateur C++ (MSVC)' -Status 'AVERTISSEMENT' -Message 'Visual Studio Build Tools installe, mais environnement developpeur non active dans ce terminal' -Detail "Installation: $vsPath | Toolset MSVC: $toolsVersion | cl.exe absent du PATH courant. Ouvrir 'Developer PowerShell for VS 2022' ou executer vcvarsall.bat avant de compiler."
} else {
    Write-Check -Section 'Compilateur C++ (MSVC)' -Status 'BLOQUANT' -Message 'Aucune installation Visual Studio avec Desktop C++ trouvee' -Detail 'Requis pour compiler mesh_processor et la partie C++ de custom_rasterizer_kernel. Installer "Visual Studio Build Tools" avec le workload "Desktop development with C++".'
}

# ---------------------------------------------------------------------------
# 6. CMake (informationnel uniquement - non requis par ce depot)
# ---------------------------------------------------------------------------
if (Test-CommandExists 'cmake') {
    $cmakeVer = (& cmake --version 2>$null | Select-Object -First 1)
    Write-Check -Section 'CMake' -Status 'OK' -Message 'cmake detecte (non requis par ce depot)' -Detail $cmakeVer
} else {
    Write-Check -Section 'CMake' -Status 'OK' -Message 'cmake absent - sans impact' -Detail 'Aucun CMakeLists.txt dans le depot : custom_rasterizer et differentiable_renderer/mesh_processor utilisent setuptools/pybind11/torch.utils.cpp_extension, pas CMake.'
}

# ---------------------------------------------------------------------------
# 7. Python + pip
# ---------------------------------------------------------------------------
$pythonCmd = $null
foreach ($cand in @('python', 'python3')) {
    if (Test-CommandExists $cand) { $pythonCmd = $cand; break }
}

if ($pythonCmd) {
    try {
        $pyVer = & $pythonCmd --version 2>&1
        $pyPath = (Get-Command $pythonCmd).Source
        Write-Check -Section 'Python (global)' -Status 'OK' -Message "$pyVer" -Detail "Executable: $pyPath"
    } catch {
        Write-Check -Section 'Python (global)' -Status 'AVERTISSEMENT' -Message 'Python trouve mais version illisible' -Detail $_.Exception.Message
    }

    if (Test-CommandExists 'pip') {
        $pipVer = & pip --version 2>&1
        Write-Check -Section 'pip (global)' -Status 'OK' -Message "$pipVer" -Detail ''
    } else {
        Write-Check -Section 'pip (global)' -Status 'AVERTISSEMENT' -Message 'pip introuvable sur le PATH' -Detail 'python -m pip peut fonctionner meme si l''alias pip n''est pas sur le PATH.'
    }
} else {
    Write-Check -Section 'Python (global)' -Status 'BLOQUANT' -Message 'Aucun interpreteur Python trouve sur le PATH' -Detail 'Python est indispensable pour installer et executer hy3dgen.'
}

# ---------------------------------------------------------------------------
# 8. Environnements virtuels (venv projet + conda)
# ---------------------------------------------------------------------------
$venvCfg = Join-Path $RepoRoot '.venv\pyvenv.cfg'
if (Test-Path $venvCfg) {
    $cfgContent = Get-Content $venvCfg -Raw
    Write-Check -Section 'venv du projet (.venv)' -Status 'OK' -Message 'Environnement virtuel deja present dans le depot' -Detail ($cfgContent -replace "`r`n", ' | ').Trim()
} else {
    Write-Check -Section 'venv du projet (.venv)' -Status 'AVERTISSEMENT' -Message 'Aucun .venv trouve a la racine du depot' -Detail 'Un environnement virtuel dedie est recommande avant l''installation des dependances.'
}

if (Test-CommandExists 'conda') {
    try {
        $condaEnvsRaw = & conda env list 2>$null
        Write-Check -Section 'Conda' -Status 'OK' -Message 'conda detecte' -Detail (($condaEnvsRaw -join ' | '))
    } catch {
        Write-Check -Section 'Conda' -Status 'AVERTISSEMENT' -Message 'conda detecte mais liste des environnements illisible' -Detail $_.Exception.Message
    }
} else {
    Write-Check -Section 'Conda' -Status 'OK' -Message 'conda absent - sans impact (venv standard utilisable)' -Detail ''
}

# ---------------------------------------------------------------------------
# 9. Git / Git LFS
# ---------------------------------------------------------------------------
if (Test-CommandExists 'git') {
    $gitVer = & git --version 2>&1
    Write-Check -Section 'Git' -Status 'OK' -Message "$gitVer" -Detail ''
} else {
    Write-Check -Section 'Git' -Status 'BLOQUANT' -Message 'git introuvable' -Detail 'Requis pour cloner/mettre a jour le depot.'
}

if (Test-CommandExists 'git-lfs') {
    $lfsVer = & git-lfs version 2>&1
    Write-Check -Section 'Git LFS' -Status 'OK' -Message "$lfsVer" -Detail ''
} else {
    Write-Check -Section 'Git LFS' -Status 'AVERTISSEMENT' -Message 'git-lfs introuvable' -Detail 'Non strictement requis (les poids sont recuperes via huggingface_hub/HTTP), mais utile si des repos HF sont clones directement via git.'
}

# ---------------------------------------------------------------------------
# 10. Espace disque (lecteur du depot + lecteur du profil utilisateur, ou sont
#     telecharges les poids par defaut : %USERPROFILE%\.cache\hy3dgen)
# ---------------------------------------------------------------------------
function Get-FreeSpaceGB {
    param([string]$Path)
    $drive = (Get-Item $Path -ErrorAction SilentlyContinue).PSDrive.Name
    if (-not $drive) { $drive = (Resolve-Path $Path).Drive.Name }
    $psdrive = Get-PSDrive -Name $drive -ErrorAction SilentlyContinue
    if ($psdrive) { return [math]::Round($psdrive.Free / 1GB, 1) }
    return $null
}

$repoDriveFree = Get-FreeSpaceGB -Path $RepoRoot
$modelsCacheDir = if ($env:HY3DGEN_MODELS) { $env:HY3DGEN_MODELS } else { Join-Path $env:USERPROFILE '.cache\hy3dgen' }
$modelsDriveFree = Get-FreeSpaceGB -Path $env:USERPROFILE

if ($null -ne $repoDriveFree) {
    if ($repoDriveFree -lt 15) {
        Write-Check -Section 'Espace disque (depot)' -Status 'BLOQUANT' -Message "${repoDriveFree} GB libres" -Detail "Lecteur du depot: $RepoRoot"
    } elseif ($repoDriveFree -lt 50) {
        Write-Check -Section 'Espace disque (depot)' -Status 'AVERTISSEMENT' -Message "${repoDriveFree} GB libres" -Detail 'Marge correcte mais serree si plusieurs modeles sont telecharges.'
    } else {
        Write-Check -Section 'Espace disque (depot)' -Status 'OK' -Message "${repoDriveFree} GB libres" -Detail ''
    }
}

if ($null -ne $modelsDriveFree) {
    $cacheDetail = "Cache modeles (HY3DGEN_MODELS ou defaut): $modelsCacheDir"
    if ($modelsDriveFree -lt 20) {
        Write-Check -Section 'Espace disque (cache modeles)' -Status 'BLOQUANT' -Message "${modelsDriveFree} GB libres" -Detail $cacheDetail
    } elseif ($modelsDriveFree -lt 50) {
        Write-Check -Section 'Espace disque (cache modeles)' -Status 'AVERTISSEMENT' -Message "${modelsDriveFree} GB libres" -Detail $cacheDetail
    } else {
        Write-Check -Section 'Espace disque (cache modeles)' -Status 'OK' -Message "${modelsDriveFree} GB libres" -Detail $cacheDetail
    }
}

# ---------------------------------------------------------------------------
# 11. Etat des extensions natives (compilees ou non) - simple constat, non bloquant
#     puisque ce script n'a pas le droit de compiler quoi que ce soit.
# ---------------------------------------------------------------------------
$rasterizerBuilt = Get-ChildItem -Path (Join-Path $RepoRoot 'hy3dgen\texgen\custom_rasterizer') -Recurse -Include '*.pyd','*.so' -ErrorAction SilentlyContinue
$meshProcessorBuilt = Get-ChildItem -Path (Join-Path $RepoRoot 'hy3dgen\texgen\differentiable_renderer') -Recurse -Include '*.pyd','*.so' -ErrorAction SilentlyContinue

if ($rasterizerBuilt) {
    Write-Check -Section 'Extension custom_rasterizer' -Status 'OK' -Message 'Artefact compile trouve' -Detail ($rasterizerBuilt.FullName -join '; ')
} else {
    Write-Check -Section 'Extension custom_rasterizer' -Status 'AVERTISSEMENT' -Message 'Non compilee (attendu a ce stade)' -Detail 'A construire en Phase 2 : cd hy3dgen\texgen\custom_rasterizer; python setup.py install (necessite nvcc).'
}

if ($meshProcessorBuilt) {
    Write-Check -Section 'Extension mesh_processor' -Status 'OK' -Message 'Artefact compile trouve' -Detail ($meshProcessorBuilt.FullName -join '; ')
} else {
    Write-Check -Section 'Extension mesh_processor' -Status 'AVERTISSEMENT' -Message 'Non compilee (attendu a ce stade)' -Detail 'A construire en Phase 2 : cd hy3dgen\texgen\differentiable_renderer; python setup.py install (necessite MSVC uniquement).'
}

# ---------------------------------------------------------------------------
# Resume
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=== Resume ===" -ForegroundColor Cyan
Write-Host ("OK: {0}   AVERTISSEMENT: {1}   BLOQUANT: {2}" -f $script:OkCount, $script:WarningCount, $script:BlockingCount)

if ($script:BlockingCount -gt 0) {
    Write-Host ""
    Write-Host "Au moins un point BLOQUANT a ete detecte. Voir le detail ci-dessus." -ForegroundColor Red
    exit 1
} else {
    Write-Host ""
    Write-Host "Aucun blocage reel detecte (des AVERTISSEMENT peuvent subsister)." -ForegroundColor Green
    exit 0
}
