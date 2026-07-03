#Requires -Version 5.1
param(
  [string]$OutputDir = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

if (-not $OutputDir) {
  $OutputDir = Join-Path $repoRoot 'samples/synthetic/gdiplus'
}

$source = @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

public static class EmfRendererGdiPlusSampleGenerator
{
    private const int Width = 480;
    private const int Height = 240;

    public static void Generate(string outputDir)
    {
        Directory.CreateDirectory(outputDir);
        Record(Path.Combine(outputDir, "synthetic-gdiplus-linear-gradient.emf"), DrawLinearGradient);
        Record(Path.Combine(outputDir, "synthetic-gdiplus-line-caps.emf"), DrawLineCaps);
        Record(Path.Combine(outputDir, "synthetic-gdiplus-line-dash.emf"), DrawLineDash);
        Record(Path.Combine(outputDir, "synthetic-gdiplus-custom-cap.emf"), DrawCustomCap);
    }

    private static void Record(string path, Action<Graphics> draw)
    {
        if (File.Exists(path))
        {
            File.Delete(path);
        }

        using (Bitmap reference = new Bitmap(1, 1, PixelFormat.Format32bppArgb))
        {
            reference.SetResolution(96, 96);

            using (Graphics referenceGraphics = Graphics.FromImage(reference))
            {
                IntPtr hdc = referenceGraphics.GetHdc();

                try
                {
                    RectangleF frame = new RectangleF(0, 0, Width, Height);

                    using (Metafile metafile = new Metafile(
                        path,
                        hdc,
                        frame,
                        MetafileFrameUnit.Pixel,
                        EmfType.EmfPlusDual,
                        "emf-renderer first-party GDI+ fixture"))
                    using (Graphics graphics = Graphics.FromImage(metafile))
                    {
                        graphics.Clear(Color.White);
                        graphics.SmoothingMode = SmoothingMode.AntiAlias;
                        draw(graphics);
                    }
                }
                finally
                {
                    referenceGraphics.ReleaseHdc(hdc);
                }
            }
        }
    }

    private static void DrawLinearGradient(Graphics graphics)
    {
        using (LinearGradientBrush left = new LinearGradientBrush(
            new RectangleF(0, 0, 80, 80),
            Color.FromArgb(100, 255, 0, 0),
            Color.Blue,
            45f))
        {
            left.WrapMode = WrapMode.Tile;
            graphics.FillRectangle(left, new RectangleF(0, 0, 240, 240));
        }

        using (LinearGradientBrush right = new LinearGradientBrush(
            new RectangleF(240, 0, 60, 60),
            Color.Lime,
            Color.Blue,
            90f))
        {
            right.WrapMode = WrapMode.TileFlipY;
            graphics.FillRectangle(right, new RectangleF(240, 0, 240, 240));
        }
    }

    private static void DrawLineCaps(Graphics graphics)
    {
        using (Pen rounded = new Pen(Color.FromArgb(220, 35, 95, 170), 12f))
        {
            rounded.StartCap = LineCap.Round;
            rounded.EndCap = LineCap.Square;
            graphics.DrawLine(rounded, 55, 70, 425, 70);
        }

        using (Pen mixed = new Pen(Color.FromArgb(220, 190, 55, 70), 12f))
        {
            mixed.StartCap = LineCap.Square;
            mixed.EndCap = LineCap.Round;
            graphics.DrawLine(mixed, 55, 165, 425, 165);
        }
    }

    private static void DrawLineDash(Graphics graphics)
    {
        using (Pen dashed = new Pen(Color.FromArgb(230, 20, 115, 85), 9f))
        {
            dashed.DashStyle = DashStyle.Dash;
            dashed.DashCap = DashCap.Round;
            graphics.DrawLine(dashed, 30, 65, 450, 65);
        }

        using (Pen custom = new Pen(Color.FromArgb(230, 135, 60, 170), 9f))
        {
            custom.DashStyle = DashStyle.Custom;
            custom.DashPattern = new float[] { 4f, 2f, 1f, 2f };
            custom.DashOffset = 1.5f;
            graphics.DrawLine(custom, 30, 165, 450, 165);
        }
    }

    private static void DrawCustomCap(Graphics graphics)
    {
        using (AdjustableArrowCap cap = new AdjustableArrowCap(8f, 12f, true))
        using (Pen pen = new Pen(Color.FromArgb(230, 30, 75, 155), 8f))
        {
            cap.BaseCap = LineCap.Flat;
            cap.MiddleInset = 1.5f;
            cap.WidthScale = 1.25f;
            pen.CustomEndCap = cap;
            pen.StartCap = LineCap.Round;
            graphics.DrawLine(pen, 45, 80, 430, 80);
            graphics.DrawLine(pen, 45, 170, 430, 170);
        }
    }
}
'@

Add-Type -TypeDefinition $source -ReferencedAssemblies System.Drawing
[EmfRendererGdiPlusSampleGenerator]::Generate($OutputDir)

Get-ChildItem -LiteralPath $OutputDir -Filter '*.emf' |
  Sort-Object Name |
  ForEach-Object { Write-Host ("generated {0} ({1} bytes)" -f $_.FullName, $_.Length) }
