import { PDFDocument } from "@cantoo/pdf-lib";
import { chromium, type Browser, type Page } from "playwright";

/** Fixed so that regenerating produces the same bytes. */
const FIXED_DATE = new Date("2026-10-15T09:00:00Z");
const A4_PX = { width: 794, height: 1123 };
/** 150 dpi equivalent: A4 at 96 css px per inch scaled by 150/96. */
const SCAN_SCALE = 150 / 96;

export async function openPage(): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: A4_PX });
  return { browser, page };
}

export async function stampPdf(
  bytes: Uint8Array,
  title: string,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  doc.setTitle(title);
  doc.setAuthor("");
  doc.setSubject("");
  doc.setKeywords([]);
  doc.setProducer("Sample corpus generator");
  doc.setCreator("Sample corpus generator");
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
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

/** Full-page PNG at scan resolution, one entry per A4 page worth of content. */
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
        scale: "device",
      }),
    );
  }
  return out;
}

export { A4_PX, SCAN_SCALE };
