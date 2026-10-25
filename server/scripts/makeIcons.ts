// Draws the app icons (a white house on the brand green) and writes them as PNGs to client/public/icons.
// No image libraries: shapes are rasterized with 4x4 supersampling and encoded with node:zlib.
// Run: npx tsx server/scripts/makeIcons.ts

import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const GREEN = [0x1f, 0x5f, 0x4a];
const WHITE = [0xff, 0xff, 0xff];

type Shape = (x: number, y: number) => boolean;

/** A house centred in the unit square, scaled to `size` (fraction of the icon). */
function house(size: number): { body: Shape; door: Shape } {
  const s = size;
  const left = 0.5 - s / 2;
  const top = 0.5 - s / 2;
  const at = (fx: number, fy: number) => [left + fx * s, top + fy * s] as const;
  const [roofL] = at(0.04, 0);
  const [roofR] = at(0.96, 0);
  const [, roofTop] = at(0, 0.02);
  const [, eaves] = at(0, 0.46);
  const [wallL] = at(0.16, 0);
  const [wallR] = at(0.84, 0);
  const [, floor] = at(0, 0.98);
  const [doorL] = at(0.41, 0);
  const [doorR] = at(0.59, 0);
  const [, doorTop] = at(0, 0.66);
  const peakX = 0.5;
  const roof: Shape = (x, y) => y >= roofTop && y <= eaves && Math.abs(x - peakX) <= ((y - roofTop) / (eaves - roofTop)) * ((roofR - roofL) / 2);
  const walls: Shape = (x, y) => x >= wallL && x <= wallR && y >= eaves - 0.001 && y <= floor;
  const door: Shape = (x, y) => x >= doorL && x <= doorR && y >= doorTop && y <= floor;
  return { body: (x, y) => roof(x, y) || walls(x, y), door };
}

function roundedSquare(radius: number): Shape {
  return (x, y) => {
    const dx = Math.max(radius - x, 0, x - (1 - radius));
    const dy = Math.max(radius - y, 0, y - (1 - radius));
    return dx * dx + dy * dy <= radius * radius;
  };
}

/** RGBA pixels: background shape in green (transparent outside), house in white with a green door. */
function draw(px: number, background: Shape, houseSize: number): Buffer {
  const { body, door } = house(houseSize);
  const out = Buffer.alloc(px * px * 4);
  const ss = 4;
  for (let j = 0; j < px; j++) {
    for (let i = 0; i < px; i++) {
      let bg = 0;
      let white = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (i + (sx + 0.5) / ss) / px;
          const y = (j + (sy + 0.5) / ss) / px;
          if (!background(x, y)) continue;
          bg++;
          if (body(x, y) && !door(x, y)) white++;
        }
      }
      const n = ss * ss;
      const alpha = bg / n;
      const w = bg ? white / bg : 0;
      const o = (j * px + i) * 4;
      for (let c = 0; c < 3; c++) out[o + c] = Math.round(GREEN[c] * (1 - w) + WHITE[c] * w);
      out[o + 3] = Math.round(alpha * 255);
    }
  }
  return out;
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(px: number, rgba: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(px, 0);
  ihdr.writeUInt32BE(px, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const rows = Buffer.alloc(px * (px * 4 + 1));
  for (let y = 0; y < px; y++) rgba.copy(rows, y * (px * 4 + 1) + 1, y * px * 4, (y + 1) * px * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const full: Shape = () => true;
const dir = "client/public/icons";
mkdirSync(dir, { recursive: true });
const icons: [string, number, Shape, number][] = [
  // Rounded tiles for browsers and desktops.
  ["icon-192.png", 192, roundedSquare(0.22), 0.6],
  ["icon-512.png", 512, roundedSquare(0.22), 0.6],
  // Maskable: full bleed, house inside the central safe zone, so any mask shape crops only background.
  ["maskable-512.png", 512, full, 0.5],
  // iOS rounds its own corners.
  ["apple-touch-icon.png", 180, full, 0.58],
  ["favicon-32.png", 32, roundedSquare(0.2), 0.72],
];
for (const [name, px, shape, houseSize] of icons) {
  writeFileSync(`${dir}/${name}`, png(px, draw(px, shape, houseSize)));
  console.log(`${dir}/${name}`);
}
