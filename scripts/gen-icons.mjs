// One-off icon generator. `sharp` isn't a project dependency (it's only ever
// needed here) — run `npm install -D sharp` before re-running this after
// editing icon-source*.svg.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

mkdirSync('public/icons', { recursive: true });

const jobs = [
  ['icon-source.svg', 'public/icons/icon-192.png', 192],
  ['icon-source.svg', 'public/icons/icon-512.png', 512],
  ['icon-source-maskable.svg', 'public/icons/icon-maskable-192.png', 192],
  ['icon-source-maskable.svg', 'public/icons/icon-maskable-512.png', 512],
];

for (const [src, out, size] of jobs) {
  await sharp(src).resize(size, size).png().toFile(out);
  console.log('wrote', out);
}

await sharp('icon-source.svg').resize(180, 180).png().toFile('public/apple-touch-icon.png');
console.log('wrote public/apple-touch-icon.png');
