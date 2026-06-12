// generate-icon.js — 生成托盘图标（纯 Node.js，无第三方依赖）
// 用法：node assets/generate-icon.js

const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

const ASSETS_DIR = __dirname;
const BLUE = [0x5B, 0x9B, 0xD5, 0xFF];
const WHITE = [0xFF, 0xFF, 0xFF, 0xFF];
const TRANS = [0x00, 0x00, 0x00, 0x00];

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

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);

  return Buffer.concat([length, typeBuffer, data, crc]);
}

function setPixel(pixels, size, x, y, color) {
  const offset = (y * size + x) * 4;
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
  pixels[offset + 3] = color[3];
}

function makePixels(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const radius = size / 2 - 1;

  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      const dx = x - size / 2 + 0.5;
      const dy = y - size / 2 + 0.5;
      const color = dx * dx + dy * dy <= radius * radius ? BLUE : TRANS;
      setPixel(pixels, size, x, y, color);
    }
  }

  const lineH = Math.max(1, Math.floor(size * 0.1));
  const startY = Math.floor(size * 0.28);
  const endY = Math.floor(size * 0.72);
  const gap = Math.floor((endY - startY) / 3);
  const x0 = Math.floor(size * 0.25);
  const x1 = Math.floor(size * 0.75);

  for (let i = 0; i < 3; i++) {
    const y = startY + i * gap;
    for (let x = x0; x <= x1; x++) {
      for (let h = 0; h < lineH; h++) {
        if (y + h < size) setPixel(pixels, size, x, y + h, WHITE);
      }
    }
  }

  return pixels;
}

function makePng(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const pixels = makePixels(size);
  const scanlineLength = 1 + size * 4;
  const raw = Buffer.alloc(scanlineLength * size);

  for (let y = 0; y < size; y++) {
    const rawOffset = y * scanlineLength;
    raw[rawOffset] = 0; // filter type: none
    pixels.copy(raw, rawOffset + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function writeIcon(name, size) {
  fs.writeFileSync(path.join(ASSETS_DIR, name), makePng(size));
  console.log(`OK ${name} (${size}x${size})`);
}

function main() {
  console.log('生成托盘图标...');
  writeIcon('tray-icon-16.png', 16);
  writeIcon('tray-icon-32.png', 32);
  writeIcon('tray-icon.png', 32);
}

main();
