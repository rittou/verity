const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeB = Buffer.from(type);
  const crcB = Buffer.alloc(4);
  crcB.writeUInt32BE(crc32(Buffer.concat([typeB, data])));
  return Buffer.concat([len, typeB, data, crcB]);
}

function createPNG(size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.44;

  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const rowOff = y * (1 + size * 4);
    raw[rowOff] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const px = rowOff + 1 + x * 4;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);

      if (dist <= radius) {
        // Shield body — emerald gradient
        const t = y / size;
        const r = Math.round(24 + t * 10);
        const g = Math.round(180 - t * 40);
        const b = Math.round(80 + t * 20);
        // Anti-alias the edge
        const edge = Math.max(0, Math.min(1, radius - dist));
        const a = Math.round(edge * 255);
        raw[px] = r;
        raw[px + 1] = g;
        raw[px + 2] = b;
        raw[px + 3] = a;
      } else {
        raw[px] = 0;
        raw[px + 1] = 0;
        raw[px + 2] = 0;
        raw[px + 3] = 0;
      }
    }
  }

  // Draw a white checkmark / "V" shape
  const stroke = Math.max(1.5, size * 0.08);
  // V shape: left arm from (0.3, 0.45) to (0.45, 0.65), right arm from (0.45, 0.65) to (0.72, 0.32)
  const points = [
    [0.3, 0.48],
    [0.45, 0.68],
    [0.45, 0.68],
    [0.73, 0.33],
  ];

  function drawLine(x0, y0, x1, y1) {
    const steps = Math.max(size * 2, 100);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const lx = x0 + (x1 - x0) * t;
      const ly = y0 + (y1 - y0) * t;
      for (let dy = -stroke; dy <= stroke; dy += 0.5) {
        for (let dx = -stroke; dx <= stroke; dx += 0.5) {
          const px = Math.round(lx * size + dx);
          const py = Math.round(ly * size + dy);
          if (px < 0 || px >= size || py < 0 || py >= size) continue;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > stroke) continue;
          const idx = py * (1 + size * 4) + 1 + px * 4;
          const alpha = Math.max(0, Math.min(1, stroke - d));
          const existing = raw[idx + 3] / 255;
          if (existing > 0.1) {
            const blend = Math.min(1, alpha);
            raw[idx] = Math.round(raw[idx] * (1 - blend) + 255 * blend);
            raw[idx + 1] = Math.round(
              raw[idx + 1] * (1 - blend) + 255 * blend,
            );
            raw[idx + 2] = Math.round(
              raw[idx + 2] * (1 - blend) + 255 * blend,
            );
            raw[idx + 3] = Math.max(raw[idx + 3], Math.round(alpha * 255));
          }
        }
      }
    }
  }

  drawLine(points[0][0], points[0][1], points[1][0], points[1][1]);
  drawLine(points[2][0], points[2][1], points[3][0], points[3][1]);

  const compressed = zlib.deflateSync(raw);

  return Buffer.concat([
    sig,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", compressed),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

const distIcons = path.join(__dirname, "..", "dist", "icons");
const pubIcons = path.join(__dirname, "..", "public", "icons");

fs.mkdirSync(distIcons, { recursive: true });
fs.mkdirSync(pubIcons, { recursive: true });

for (const size of [16, 48, 128]) {
  const png = createPNG(size);
  fs.writeFileSync(path.join(distIcons, `icon${size}.png`), png);
  fs.writeFileSync(path.join(pubIcons, `icon${size}.png`), png);
  console.log(`Created icon${size}.png (${png.length} bytes)`);
}
