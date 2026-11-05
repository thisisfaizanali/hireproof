import { PDFDocument } from "@cantoo/pdf-lib";
import sharp from "sharp";
import { stampDoc } from "./browser.js";
import { hashString, seeded } from "./rng.js";
import type { ScanStrength } from "./types.js";

interface Degrade {
  /** Degrees of rotation, as if the page was fed in crooked. */
  angle: number;
  blur: number;
  /** Paper brightness, 255 is white. */
  paper: number;
  noise: number;
  /** 1 keeps the render resolution, lower values lose detail. */
  resolution: number;
  quality: number;
  specks: number;
}

const PRESETS: Record<ScanStrength, Degrade> = {
  clean: {
    angle: 0.4,
    blur: 0.5,
    paper: 250,
    noise: 3,
    resolution: 1,
    quality: 78,
    specks: 20,
  },
  tilted: {
    angle: 1.4,
    blur: 0.8,
    paper: 226,
    noise: 9,
    resolution: 1,
    quality: 62,
    specks: 120,
  },
  rough: {
    angle: -1.9,
    blur: 1.1,
    paper: 214,
    noise: 16,
    resolution: 0.78,
    quality: 45,
    specks: 400,
  },
};

/** Turns a clean page render into something that looks like it came off a scanner. */
export async function degrade(
  png: Buffer,
  strength: ScanStrength,
  seed: string,
): Promise<Buffer> {
  const p = PRESETS[strength];
  const rand = seeded(hashString(seed));
  const base = sharp(png).greyscale();
  const { width, height } = await base.metadata();
  const w = width!;
  const h = height!;

  const rotated = await base
    .blur(p.blur)
    .rotate(p.angle, { background: "#bdbbb5" })
    .toBuffer({ resolveWithObject: true });
  const left = Math.floor((rotated.info.width - w) / 2);
  const top = Math.floor((rotated.info.height - h) / 2);
  const { data, info } = await sharp(rotated.data)
    .extract({ left, top, width: w, height: h })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 1)
    throw new Error(`expected 1 channel, got ${info.channels}`);

  const paper = p.paper / 255;
  for (let y = 0; y < h; y++) {
    const dy = (y / h - 0.5) * 2;
    for (let x = 0; x < w; x++) {
      const dx = (x / w - 0.5) * 2;
      const vignette = 1 - 0.07 * (dx * dx + dy * dy) * (p.noise / 8 + 0.5);
      const grain = (rand() + rand() + rand() - 1.5) * p.noise * 2;
      const i = y * w + x;
      data[i] = Math.max(0, Math.min(255, data[i] * paper * vignette + grain));
    }
  }
  for (let s = 0; s < p.specks; s++) {
    const cx = Math.floor(rand() * w);
    const cy = Math.floor(rand() * h);
    const r = 1 + Math.floor(rand() * 2);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < w && y >= 0 && y < h)
          data[y * w + x] = 90 + Math.floor(rand() * 60);
      }
    }
  }

  let out = sharp(data, { raw: { width: w, height: h, channels: 1 } });
  if (p.resolution < 1) {
    // Lose detail by shrinking, then stretch back so the page size is unchanged.
    const sw = Math.round(w * p.resolution);
    const sh = Math.round(h * p.resolution);
    const small = await out
      .resize(sw, sh)
      .raw()
      .toBuffer({ resolveWithObject: true });
    out = sharp(small.data, {
      raw: {
        width: small.info.width,
        height: small.info.height,
        channels: small.info.channels,
      },
    }).resize(w, h);
  }
  return out.jpeg({ quality: p.quality }).toBuffer();
}

/** Wraps scan images into a PDF that has no text layer at all. */
export async function imagesToPdf(
  jpegs: Buffer[],
  title: string,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  stampDoc(doc, title);
  for (const jpg of jpegs) {
    const img = await doc.embedJpg(jpg);
    const page = doc.addPage([595.28, 841.89]);
    page.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
  }
  return doc.save();
}
