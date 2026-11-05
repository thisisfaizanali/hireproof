import { PDFDocument } from "@cantoo/pdf-lib";
import { chromium, type Browser, type Page } from "playwright";

/** Fixed so that regenerating produces the same bytes. */
const FIXED_DATE = new Date("2026-10-15T09:00:00Z");
export const A4_PX = { width: 794, height: 1123 };
/** 150 dpi equivalent: css pixels are 96 per inch. */
export const SCAN_SCALE = 150 / 96;

export async function openPage(
  scale = 1,
): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: A4_PX,
    deviceScaleFactor: scale,
  });
  return { browser, page };
}

export function stampDoc(doc: PDFDocument, title: string) {
  doc.setTitle(title);
  doc.setAuthor("");
  doc.setSubject("");
  doc.setKeywords([]);
  doc.setProducer("Sample corpus generator");
  doc.setCreator("Sample corpus generator");
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
}

async function stampPdf(bytes: Uint8Array, title: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  stampDoc(doc, title);
  return doc.save();
}

export async function htmlToPdf(
  page: Page,
  html: string,
  title: string,
): Promise<Uint8Array> {
  await page.setContent(html, { waitUntil: "load" });
  const pdf = await page.pdf({
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
  });
  return stampPdf(pdf, title);
}

/** One PNG per A4 page worth of content, at the page's device scale. */
export async function htmlToPages(page: Page, html: string): Promise<Buffer[]> {
  await page.setContent(html, { waitUntil: "load" });
  const height = await page.evaluate(
    () => document.documentElement.scrollHeight,
  );
  const count = Math.max(1, Math.ceil((height - 2) / A4_PX.height));
  const out: Buffer[] = [];
  for (let i = 0; i < count; i++) {
    out.push(
      await page.screenshot({
        clip: {
          x: 0,
          y: i * A4_PX.height,
          width: A4_PX.width,
          height: A4_PX.height,
        },
        fullPage: true,
      }),
    );
  }
  return out;
}
