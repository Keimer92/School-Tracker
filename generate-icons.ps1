Add-Type -AssemblyName System.Drawing

$iconDir = "D:\Mis Proyectos\Tauri\School Tracker Pro\src-tauri\icons"

$sizes = @(32, 128, 256)

foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

    # Background gradient (blue to purple)
    $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, [System.Drawing.Color]::FromArgb(59, 130, 246), [System.Drawing.Color]::FromArgb(167, 139, 250), 45)
    $g.FillRectangle($brush, $rect)

    # Circle (white)
    $margin = [int]($size * 0.15)
    $g.FillEllipse([System.Drawing.Brushes]::White, $margin, $margin, $size - 2*$margin, $size - 2*$margin)

    # "S" letter
    $fontSize = [int]($size * 0.4)
    $font = New-Object System.Drawing.Font("Arial", $fontSize, [System.Drawing.FontStyle]::Bold)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $textRect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
    $g.DrawString("S", $font, [System.Drawing.Brushes]::FromArgb(59, 130, 246), $textRect, $sf)

    $g.Dispose()

    if ($size -eq 32) {
        $bmp.Save("$iconDir\32x32.png", [System.Drawing.Imaging.ImageFormat]::Png)
    } elseif ($size -eq 128) {
        $bmp.Save("$iconDir\128x128.png", [System.Drawing.Imaging.ImageFormat]::Png)
    } elseif ($size -eq 256) {
        $bmp.Save("$iconDir\128x128@2x.png", [System.Drawing.Imaging.ImageFormat]::Png)
    }

    $bmp.Dispose()
}

# Create icon.ico from 256px bitmap
$ico256 = New-Object System.Drawing.Bitmap(256, 256)
$g = [System.Drawing.Graphics]::FromImage($ico256)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$rect = New-Object System.Drawing.Rectangle(0, 0, 256, 256)
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, [System.Drawing.Color]::FromArgb(59, 130, 246), [System.Drawing.Color]::FromArgb(167, 139, 250), 45)
$g.FillRectangle($brush, $rect)
$g.FillEllipse([System.Drawing.Brushes]::White, 38, 38, 180, 180)
$font = New-Object System.Drawing.Font("Arial", 102, [System.Drawing.FontStyle]::Bold)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$textRect = New-Object System.Drawing.RectangleF(0, 0, 256, 256)
$g.DrawString("S", $font, [System.Drawing.Brushes]::FromArgb(59, 130, 246), $textRect, $sf)
$g.Dispose()

# Save as ICO
$icon = [System.Drawing.Icon]::FromHandle($ico256.GetHicon())
$fs = [System.IO.File]::Create("$iconDir\icon.ico")
$icon.Save($fs)
$fs.Close()
$ico256.Dispose()

# Create empty icns (macOS will ignore if not valid)
[System.IO.File]::WriteAllBytes("$iconDir\icon.icns", [byte[]]@())

Write-Host "Iconos creados en $iconDir"
Write-Host "Archivos: 32x32.png, 128x128.png, 128x128@2x.png, icon.ico, icon.icns"