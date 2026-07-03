#Requires -Version 5.1
<#
.SYNOPSIS
  Render the visual-golden core EMF samples through native GDI+ (System.Drawing)
  into reference PNGs, for diffing against this renderer's output.

.DESCRIPTION
  Windows-only. System.Drawing IS GDI+, which natively plays both classic EMF and
  EMF+ records, so it is the ground-truth "is our render correct vs Windows?"
  reference that the darwin Playwright snapshots cannot provide (those only prove
  self-consistency).

  For each core sample of the requested tier (enumerated by visual-golden.js plan),
  the metafile is drawn into a white W x H bitmap and saved as <key>-<tier>.png.

  W and H are read from the already-captured "actual" PNG (this renderer's output,
  produced by `EMF_CAPTURE_GOLDEN_ACTUAL=1 playwright test golden-capture`). Taking
  the size from our own render guarantees the reference matches dimension-for-
  dimension, so visual-golden.js verify performs a content-only pixel diff instead
  of failing on an image-size mismatch.

.PARAMETER Tier
  windows-gdi (classic EMF core samples) or windows-gdiplus (EMF+ core samples).

.PARAMETER SamplesRoot
  Root of the .emf sample tree (default: samples).

.PARAMETER ActualDir
  Directory holding this renderer's captured PNGs, used only to read target sizes
  (default: tests/visual/actual/<tier>).

.PARAMETER OutDir
  Where to write the GDI+ reference PNGs (default: tests/visual/gdiplus-out/<tier>).
  Feed this to `node scripts/visual-golden.js generate --tier <tier> --source-dir <OutDir>`.

.EXAMPLE
  ./scripts/render-gdiplus.ps1 -Tier windows-gdiplus
#>
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('windows-gdi', 'windows-gdiplus')]
  [string]$Tier,
  [string]$SamplesRoot = 'samples',
  [string]$ActualDir = '',
  [string]$OutDir = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $ActualDir) { $ActualDir = Join-Path $repoRoot "tests/visual/actual/$Tier" }
if (-not $OutDir) { $OutDir = Join-Path $repoRoot "tests/visual/gdiplus-out/$Tier" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# The plan lists this tier's core samples with their canonical file keys.
$planJson = & node (Join-Path $repoRoot 'scripts/visual-golden.js') plan --tier $Tier | Out-String
$plan = $planJson | ConvertFrom-Json
$samples = @($plan.samples)

$rendered = 0
$problems = @()

foreach ($sample in $samples) {
  $fileName = "$($sample.key)-$Tier.png"
  $emfPath = Join-Path $repoRoot (Join-Path $SamplesRoot $sample.sample)
  $actualPng = Join-Path $ActualDir $fileName
  $outPath = Join-Path $OutDir $fileName

  if (-not (Test-Path $emfPath)) { $problems += "missing EMF: $emfPath"; continue }
  if (-not (Test-Path $actualPng)) { $problems += "missing actual PNG (needed for target size): $actualPng"; continue }

  # Target size = this renderer's own output dimensions for the same metafile.
  $sizeImage = [System.Drawing.Image]::FromFile($actualPng)
  try {
    $width = $sizeImage.Width
    $height = $sizeImage.Height
  } finally {
    $sizeImage.Dispose()
  }

  # GDI+ plays the metafile into the device rectangle, over white. NOTE: GDI+
  # DrawImage maps the metafile's frame/bounds onto this rect differently from how
  # our renderer sizes its own canvas, so references carry a systematic scale/
  # origin offset vs our output (worst on samples with a non-zero bounds origin,
  # e.g. linear-gradient whose bounds.top is 288). An explicit src->dest pixel
  # overload was tried and changed nothing — the offset is inherent to GDI+'s
  # mapping. This loop is therefore a visual/content radar, not a pixel-exact
  # gate; see the visual-tier notes in samples/README.md.
  $metafile = [System.Drawing.Image]::FromFile($emfPath)
  $bitmap = New-Object System.Drawing.Bitmap -ArgumentList $width, $height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear([System.Drawing.Color]::White)
    $rect = New-Object System.Drawing.Rectangle -ArgumentList 0, 0, $width, $height
    $graphics.DrawImage($metafile, $rect)
  } finally {
    $graphics.Dispose()
    $metafile.Dispose()
  }
  $bitmap.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
  $rendered++
  Write-Host ("rendered {0} ({1}x{2})" -f $fileName, $width, $height)
}

Write-Host ("GDI+ rendered {0}/{1} sample(s) for tier {2} -> {3}" -f $rendered, $samples.Count, $Tier, $OutDir)

if ($problems.Count -gt 0) {
  Write-Host 'PROBLEMS:'
  $problems | ForEach-Object { Write-Host "  $_" }
  exit 1
}
