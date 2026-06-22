// generate-icon.js — 从选定 Logo 预览源图生成应用图标与托盘图标
// 用法：node assets/generate-icon.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ASSETS_DIR = __dirname;
const SOURCE_IMAGE = path.join(ASSETS_DIR, 'logo-source-quick-recall.png');
const OUTPUT_SIZES = [16, 24, 32, 48, 64, 128, 256];

function psString(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);

  return Buffer.concat([length, typeBuffer, data, crc]);
}

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = makeCrcTable();

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makeTransparentPng(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const scanlineLength = 1 + size * 4;
  const raw = Buffer.alloc(scanlineLength * size);

  for (let y = 0; y < size; y++) {
    raw[y * scanlineLength] = 0;
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', require('zlib').deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function makeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(images.length * 16);
  let offset = header.length + directory.length;

  images.forEach((image, index) => {
    const entryOffset = index * 16;
    directory[entryOffset] = image.size === 256 ? 0 : image.size;
    directory[entryOffset + 1] = image.size === 256 ? 0 : image.size;
    directory[entryOffset + 2] = 0;
    directory[entryOffset + 3] = 0;
    directory.writeUInt16LE(1, entryOffset + 4);
    directory.writeUInt16LE(32, entryOffset + 6);
    directory.writeUInt32LE(image.png.length, entryOffset + 8);
    directory.writeUInt32LE(offset, entryOffset + 12);
    offset += image.png.length;
  });

  return Buffer.concat([header, directory, ...images.map((image) => image.png)]);
}

function runPowerShell(script) {
  execFileSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script
  ], { stdio: 'inherit' });
}

function cropAndRenderPngs(tempDir) {
  const sizesLiteral = OUTPUT_SIZES.join(',');
  const script = `
Add-Type -AssemblyName System.Drawing

$sourcePath = ${psString(SOURCE_IMAGE)}
$outDir = ${psString(tempDir)}
$sizes = @(${sizesLiteral})

$src = [System.Drawing.Bitmap]::FromFile($sourcePath)
try {
  # 第 4 款预览图的上半部分是目标图标，下半部分是字标锁定组合。
  # 先在上半区自动寻找非白背景内容，避免裁入底部“贴友 TieU”字标。
  $scanLimitY = [Math]::Floor($src.Height * 0.70)
  $minX = $src.Width
  $minY = $src.Height
  $maxX = 0
  $maxY = 0

  for ($y = 0; $y -lt $scanLimitY; $y += 2) {
    for ($x = 0; $x -lt $src.Width; $x += 2) {
      $p = $src.GetPixel($x, $y)
      $isBackground = $p.R -gt 245 -and $p.G -gt 245 -and $p.B -gt 245
      if (-not $isBackground) {
        if ($x -lt $minX) { $minX = $x }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -lt $minY) { $minY = $y }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }

  if ($maxX -le $minX -or $maxY -le $minY) {
    throw '未能从 Logo 源图中定位图标区域。'
  }

  $pad = 34
  $minX = [Math]::Max(0, $minX - $pad)
  $minY = [Math]::Max(0, $minY - $pad)
  $maxX = [Math]::Min($src.Width - 1, $maxX + $pad)
  $maxY = [Math]::Min($src.Height - 1, $maxY + $pad)

  $boxW = $maxX - $minX + 1
  $boxH = $maxY - $minY + 1
  $side = [Math]::Max($boxW, $boxH)
  $cropX = [Math]::Max(0, [Math]::Floor($minX - ($side - $boxW) / 2))
  $cropY = [Math]::Max(0, [Math]::Floor($minY - ($side - $boxH) / 2))

  if ($cropX + $side -gt $src.Width) { $cropX = $src.Width - $side }
  if ($cropY + $side -gt $src.Height) { $cropY = $src.Height - $side }

  $cropRect = New-Object System.Drawing.Rectangle($cropX, $cropY, $side, $side)
  $cropped = $src.Clone($cropRect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    foreach ($size in $sizes) {
      $canvas = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
      try {
        $graphics = [System.Drawing.Graphics]::FromImage($canvas)
        try {
          $graphics.Clear([System.Drawing.Color]::Transparent)
          $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
          $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
          $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
          $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
          $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
          $graphics.DrawImage($cropped, 0, 0, $size, $size)
        } finally {
          $graphics.Dispose()
        }

        # 只清除与边缘连通的近白色背景，保留图标内部的白色卡片。
        $visited = New-Object 'bool[,]' $size, $size
        $queue = New-Object 'System.Collections.Generic.Queue[object]'
        for ($i = 0; $i -lt $size; $i++) {
          $queue.Enqueue(@($i, 0))
          $queue.Enqueue(@($i, ($size - 1)))
          $queue.Enqueue(@(0, $i))
          $queue.Enqueue(@(($size - 1), $i))
        }

        while ($queue.Count -gt 0) {
          $point = $queue.Dequeue()
          $x = [int]$point[0]
          $y = [int]$point[1]
          if ($x -lt 0 -or $x -ge $size -or $y -lt 0 -or $y -ge $size) { continue }
          if ($visited[$x, $y]) { continue }
          $visited[$x, $y] = $true

          $p = $canvas.GetPixel($x, $y)
          $isOuterBackground = $p.A -eq 0 -or ($p.R -gt 238 -and $p.G -gt 238 -and $p.B -gt 238)
          if (-not $isOuterBackground) { continue }

          $canvas.SetPixel($x, $y, [System.Drawing.Color]::Transparent)
          $queue.Enqueue(@(($x + 1), $y))
          $queue.Enqueue(@(($x - 1), $y))
          $queue.Enqueue(@($x, ($y + 1)))
          $queue.Enqueue(@($x, ($y - 1)))
        }

        $canvas.Save((Join-Path $outDir "icon-$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
      } finally {
        $canvas.Dispose()
      }
    }
  } finally {
    $cropped.Dispose()
  }
} finally {
  $src.Dispose()
}
`;

  runPowerShell(script);
}

function copyGeneratedPngs(tempDir) {
  const pngBySize = new Map();

  for (const size of OUTPUT_SIZES) {
    const png = fs.readFileSync(path.join(tempDir, `icon-${size}.png`));
    pngBySize.set(size, png);
  }

  fs.writeFileSync(path.join(ASSETS_DIR, 'icon.png'), pngBySize.get(256));
  fs.writeFileSync(path.join(ASSETS_DIR, 'tray-icon-16.png'), pngBySize.get(16));
  fs.writeFileSync(path.join(ASSETS_DIR, 'tray-icon-32.png'), pngBySize.get(32));
  fs.writeFileSync(path.join(ASSETS_DIR, 'tray-icon.png'), pngBySize.get(32));

  const icoImages = OUTPUT_SIZES.map((size) => ({ size, png: pngBySize.get(size) || makeTransparentPng(size) }));
  fs.writeFileSync(path.join(ASSETS_DIR, 'icon.ico'), makeIco(icoImages));
}

function main() {
  if (!fs.existsSync(SOURCE_IMAGE)) {
    throw new Error(`缺少 Logo 源图：${SOURCE_IMAGE}`);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tieu-icon-'));
  try {
    cropAndRenderPngs(tempDir);
    copyGeneratedPngs(tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log('OK icon.png (256x256 PNG)');
  console.log('OK tray-icon-16.png (16x16 PNG)');
  console.log('OK tray-icon-32.png (32x32 PNG)');
  console.log('OK tray-icon.png (32x32 PNG)');
  console.log('OK icon.ico (multi-size ICO)');
}

main();
