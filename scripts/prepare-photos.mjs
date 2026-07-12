/* One-off asset pipeline for the wow-experience redesign: exports web-ready
   derivatives of curated REAL event photographs from the vault archive into
   public/assets/photos/. Each photo gets a wide jpg (quality-tuned) plus a
   webp at two sizes. Sources stay in the vault untouched; new pulls need
   Mervat's publication clearance before production (staging preview only). */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const VAULT = '/Users/ismac/Documents/Projects/WAI-ME/WAI/04 Events';
const OUT = new URL('../public/assets/photos/', import.meta.url).pathname;

/* name -> [vault-relative source, widest export] */
const PHOTOS = {
  'hero-front-row': ['2017 Airport Show/DSC_7316.jpg', 2400],
  'audience-profile': ['2017 Airport Show/DSC_7638.jpg', 1800],
  'audience-depth': ['2017 Airport Show/DSC_7108.jpg', 1800],
  'stage-group-2017': ['2017 Airport Show/DSC_7401.jpg', 1600],
  'assembly-certificates': ['2025 Saudi/Footage/DSC00908.jpg', 2400],
  'assembly-panel': ['2025 Saudi/Footage/DSC01553.jpg', 1800],
  'assembly-portrait': ['2025 Saudi/Footage/DSC01194.jpg', 1400],
  'assembly-booth': ['2025 Saudi/Footage/DSC01433.jpg', 1400],
  'lectern-2022': ['2022 Airport Show/image00011.jpeg', 1400],
  'fireside-2022': ['2022 Airport Show/image00010.jpeg', 1600],
};

await mkdir(OUT, { recursive: true });

for (const [name, [rel, wide]] of Object.entries(PHOTOS)) {
  const src = path.join(VAULT, rel);
  const base = sharp(src).rotate();
  await base
    .clone()
    .resize({ width: wide, withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true })
    .toFile(path.join(OUT, `${name}.jpg`));
  await base
    .clone()
    .resize({ width: wide, withoutEnlargement: true })
    .webp({ quality: 74 })
    .toFile(path.join(OUT, `${name}.webp`));
  await base
    .clone()
    .resize({ width: 900, withoutEnlargement: true })
    .webp({ quality: 72 })
    .toFile(path.join(OUT, `${name}-900.webp`));
  console.log(`ok ${name}`);
}
