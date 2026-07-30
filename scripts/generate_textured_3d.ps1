<#
.SYNOPSIS
    Windows launcher for scripts\generate_textured_3d.py (image -> textured GLB).

.DESCRIPTION
    Thin wrapper: locates the repo's own .venv (relative to this script, not to
    the current directory), forwards the essential parameters, and propagates
    the Python process's exit code unchanged. Does not modify any environment
    variable or system-wide setting. Safe to invoke from any working directory.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\generate_textured_3d.ps1 `
      -Image assets\demo.png -OutputDir outputs\demo-run -LowVram

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\generate_textured_3d.ps1 `
      -Image assets\demo.png -OutputDir outputs\demo-shape -ShapeOnly
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$Image,
    [Parameter(Mandatory)] [string]$OutputDir,
    [int]$Seed = 1234,
    [int]$ShapeSteps = 5,
    [double]$GuidanceScale = 5.0,
    [int]$OctreeResolution = 256,
    [int]$MaxFaces = 40000,
    [string]$ShapeModel = 'tencent/Hunyuan3D-2mini',
    [string]$ShapeSubfolder = 'hunyuan3d-dit-v2-mini-turbo',
    [string]$TextureModel = 'tencent/Hunyuan3D-2',
    [string]$TextureSubfolder = 'hunyuan3d-paint-v2-0-turbo',
    [switch]$LowVram,
    [switch]$ShapeOnly,
    [switch]$Overwrite
)

$ErrorActionPreference = 'Stop'

# Repo root = parent of this script's own directory, regardless of $PWD.
$RepoRoot = Split-Path -Parent $PSScriptRoot
$VenvPython = Join-Path $RepoRoot '.venv\Scripts\python.exe'
$TargetScript = Join-Path $RepoRoot 'scripts\generate_textured_3d.py'

if (-not (Test-Path -LiteralPath $VenvPython)) {
    Write-Error "Virtual environment not found at: $VenvPython`nRun 'pip install -r requirements.txt' inside a .venv created at the repo root first."
    exit 2
}

if (-not (Test-Path -LiteralPath $TargetScript)) {
    Write-Error "Target script not found at: $TargetScript"
    exit 2
}

$pyArgs = @(
    $TargetScript,
    '--image', $Image,
    '--output-dir', $OutputDir,
    '--seed', $Seed,
    '--shape-steps', $ShapeSteps,
    '--guidance-scale', $GuidanceScale,
    '--octree-resolution', $OctreeResolution,
    '--max-faces', $MaxFaces,
    '--shape-model', $ShapeModel,
    '--shape-subfolder', $ShapeSubfolder,
    '--texture-model', $TextureModel,
    '--texture-subfolder', $TextureSubfolder
)

if ($LowVram) { $pyArgs += '--low-vram' }
if ($ShapeOnly) { $pyArgs += '--shape-only' }
if ($Overwrite) { $pyArgs += '--overwrite' }

Write-Host "Repo root   : $RepoRoot"
Write-Host "Python      : $VenvPython"
Write-Host "Output dir  : $OutputDir"
Write-Host ""

& $VenvPython @pyArgs
exit $LASTEXITCODE
