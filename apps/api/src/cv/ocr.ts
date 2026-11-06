import { createRequire } from "node:module";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { createScheduler, createWorker, type Scheduler } from "tesseract.js";
import { getDocumentProxy, renderPageAsImage } from "unpdf";

// A text layer thinner than this per page means the PDF is a scan (or close to one).
const MIN_CHARS_PER_PAGE = 100;
const OCR_PAGES = 3;
const WORKERS = 2;
// Pages are drawn at this multiple of their PDF size. Higher is not better:
// scanner speckle grows with the image and the denoise step stops catching it.
const RENDER_SCALE = 2;
// Mean confidence below this adds a review reason.
export const LOW_OCR_CONFIDENCE = 70;
const CLEAN_BELOW = 80;

export const needsOcr = (text: string, pages: number | null) =>
  text.replace(/\s/g, "").length / Math.max(pages ?? 1, 1) < MIN_CHARS_PER_PAGE;

const { langPath } = createRequire(__filename)("@tesseract.js-data/eng") as {
  langPath: string;
};

let scheduler: Promise<Scheduler> | undefined;

function getScheduler() {
  scheduler ??= (async () => {
    const pool = createScheduler();
    for (let i = 0; i < WORKERS; i++) {
      // The language data ships in an npm package, so no network is needed.
      pool.addWorker(
        await createWorker("eng", 1, {
          langPath,
          gzip: true,
          cacheMethod: "none",
        }),
      );
    }
    return pool;
  })();
  return scheduler;
}

export async function stopOcr() {
  const pool = scheduler;
  scheduler = undefined;
  if (pool) await (await pool).terminate();
}

// Phone scans come with grey paper, uneven light and speckle, which Tesseract
// misreads badly. Flatten the lighting against a heavily blurred copy of the
// page, then take the median of each 3x3 patch to remove the specks.
async function cleanScan(png: Uint8Array): Promise<Buffer> {
  const image = await loadImage(Buffer.from(png));
  const { width: w, height: h } = image;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, w, h);
  const rgba = pixels.data;
  const grey = new Uint8Array(w * h);
  for (let i = 0; i < grey.length; i++) {
    grey[i] =
      (rgba[i * 4] * 299 + rgba[i * 4 + 1] * 587 + rgba[i * 4 + 2] * 114) /
      1000;
  }

  const median = new Uint8Array(grey);
  const patch = new Uint8Array(9);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++)
          patch[k++] = grey[(y + dy) * w + x + dx];
      }
      patch.sort();
      median[y * w + x] = patch[4];
    }
  }

  const small = createCanvas(Math.ceil(w / 24), Math.ceil(h / 24));
  const flat = createCanvas(w, h);
  const flatCtx = flat.getContext("2d");
  const source = flatCtx.createImageData(w, h);
  for (let i = 0; i < median.length; i++) {
    source.data.fill(median[i], i * 4, i * 4 + 3);
    source.data[i * 4 + 3] = 255;
  }
  flatCtx.putImageData(source, 0, 0);
  small.getContext("2d").drawImage(flat, 0, 0, small.width, small.height);
  flatCtx.drawImage(small, 0, 0, w, h);
  const background = flatCtx.getImageData(0, 0, w, h).data;

  for (let i = 0; i < median.length; i++) {
    const value = Math.min(
      255,
      (median[i] / Math.max(background[i * 4], 1)) * 255 * 1.05,
    );
    rgba.fill(value, i * 4, i * 4 + 3);
    rgba[i * 4 + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas.toBuffer("image/png");
}

export async function ocrPdf(
  buffer: Buffer,
): Promise<{ text: string; confidence: number }> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const pool = await getScheduler();
  const count = Math.min(pdf.numPages, OCR_PAGES);
  const pages = await Promise.all(
    Array.from({ length: count }, async (_, i) => {
      const image = await renderPageAsImage(pdf, i + 1, {
        canvasImport: () => import("@napi-rs/canvas"),
        scale: RENDER_SCALE,
      });
      const raw = Buffer.from(image);
      let best = (await pool.addJob("recognize", raw)).data;
      // Clean scans read better untouched, so the cleaned copy is only tried
      // when the first read is shaky, and wins only if it scores higher.
      if (best.confidence < CLEAN_BELOW) {
        const retry = (await pool.addJob("recognize", await cleanScan(image)))
          .data;
        if (retry.confidence > best.confidence) best = retry;
      }
      return { text: best.text, confidence: best.confidence };
    }),
  );
  return {
    text: pages.map((p) => p.text.trim()).join("\n\n"),
    confidence:
      pages.reduce((sum, p) => sum + p.confidence, 0) / (pages.length || 1),
  };
}
