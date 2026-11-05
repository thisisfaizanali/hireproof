import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import mammoth from "mammoth";
import type { Page } from "playwright";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { openPage } from "./browser.js";
import { candidates } from "./data/index.js";
import { PDF_PASSWORD } from "./edge.js";
import { INJECTION_TEXT } from "./html.js";
import { renderHtml } from "./layouts.js";
import { manifestSchema, type Manifest } from "./manifest.js";

export const SAMPLES = resolve(import.meta.dirname, "../../../samples");
const EM_DASH = String.fromCodePoint(0x2014);
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

async function pdfText(
  data: Uint8Array,
  password?: string,
): Promise<{ text: string; pages: number }> {
  const doc = await getDocument({
    data: new Uint8Array(data),
    password,
    verbosity: 0,
  }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    text +=
      content.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n";
  }
  return { text, pages: doc.numPages };
}

const docxText = async (data: Buffer) =>
  (await mammoth.extractRawText({ buffer: data })).value;

/** The name of the error a call throws, or null when it succeeds. */
async function errorName(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (e) {
    return (e as Error).name;
  }
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name)],
  );
}

/** The injection element must change the text layer but not a single pixel. */
async function injectionIsInvisible(page: Page): Promise<boolean> {
  const c = candidates.find((x) => x.adversarial === "promptInjection")!;
  await page.setContent(renderHtml(c, true), { waitUntil: "load" });
  const withText = await page.screenshot({ fullPage: true });
  await page.evaluate(() =>
    document.querySelector('div[style*="font-size:1px"]')?.remove(),
  );
  const without = await page.screenshot({ fullPage: true });
  return withText.equals(without);
}

export async function verifyCorpus(): Promise<void> {
  const failures: string[] = [];
  const check = (ok: boolean, message: string) => {
    if (!ok) failures.push(message);
  };

  const manifest: Manifest = manifestSchema.parse(
    JSON.parse(readFileSync(join(SAMPLES, "manifest.json"), "utf8")),
  );

  // Every file is in the manifest and every manifest entry has a file.
  const onDisk = new Set(
    listFiles(SAMPLES)
      .map((f) => f.slice(SAMPLES.length + 1).replaceAll("\\", "/"))
      .filter((f) => f !== "manifest.json" && f !== "README.md"),
  );
  const listed = new Set(
    [...manifest.jds, ...manifest.cvs, ...manifest.edge].map((e) => e.file),
  );
  for (const f of onDisk)
    check(listed.has(f), `orphan file not in manifest: ${f}`);
  for (const f of listed)
    check(onDisk.has(f), `manifest entry without file: ${f}`);

  const total = listFiles(SAMPLES).reduce((n, f) => n + statSync(f).size, 0);
  check(
    total < MAX_TOTAL_BYTES,
    `samples are ${total} bytes, over the 25 MB limit`,
  );

  for (const cv of manifest.cvs) {
    const data = readFileSync(join(SAMPLES, cv.file));
    if (cv.isScan) {
      check(
        (await pdfText(data)).text.trim() === "",
        `${cv.file}: scan has a text layer`,
      );
      continue;
    }
    const text =
      cv.format === "pdf" ? (await pdfText(data)).text : await docxText(data);
    const flat = text.replace(/\s+/g, " ");
    check(
      flat.includes(cv.name),
      `${cv.file}: name missing from extracted text`,
    );
    if (cv.email)
      check(
        flat.includes(cv.email),
        `${cv.file}: email missing from extracted text`,
      );
    if (cv.phone)
      check(
        flat.includes(cv.phone),
        `${cv.file}: phone missing from extracted text`,
      );
    check(
      !flat.includes("CND-"),
      `${cv.file}: candidate id leaked into the CV`,
    );
    check(!flat.includes(EM_DASH), `${cv.file}: contains an em dash`);
    check(
      (cv.adversarial === "promptInjection") === flat.includes(INJECTION_TEXT),
      `${cv.file}: injection text presence is wrong`,
    );
  }

  for (const jd of manifest.jds) {
    const data = readFileSync(join(SAMPLES, jd.file));
    const text =
      jd.format === "pdf"
        ? (await pdfText(data)).text
        : jd.format === "docx"
          ? await docxText(data)
          : data.toString("utf8");
    check(text.length > 150, `${jd.file}: too little text`);
    check(!text.includes(EM_DASH), `${jd.file}: contains an em dash`);
  }

  for (const e of manifest.edge) {
    const data = readFileSync(join(SAMPLES, e.file));
    const name = basename(e.file);
    if (name.startsWith("Vandana")) {
      check(
        (await errorName(() => pdfText(data))) !== null,
        `${e.file}: should not open`,
      );
    } else if (name.endsWith("protected.pdf")) {
      check(
        (await errorName(() => pdfText(data))) === "PasswordException",
        `${e.file}: should ask for a password`,
      );
      check(
        (await pdfText(data, PDF_PASSWORD)).text.includes("Vandana Rawal"),
        `${e.file}: should open with its password`,
      );
    } else if (name === "Rajiv_Menon_CV.docx") {
      check(
        (await docxText(data)).trim() === "",
        `${e.file}: should hold no text`,
      );
    } else if (name.startsWith("Cover_Letter")) {
      const text = (await pdfText(data)).text;
      check(
        text.length > 300 && !/experience|education|skills/i.test(text),
        `${e.file}: should read as a letter`,
      );
    } else if (name.startsWith("Kiran")) {
      check(
        data.length > 8e6 && data.length < 10e6,
        `${e.file}: ${data.length} bytes is outside 8 to 10 MB`,
      );
      check(
        (await pdfText(data)).pages === 2,
        `${e.file}: should have two pages`,
      );
    }
  }

  const withPersonal = manifest.cvs.filter((c) =>
    c.personalFieldsPresent.some((f) => f !== "photo"),
  ).length;
  const withPhoto = manifest.cvs.filter((c) =>
    c.personalFieldsPresent.includes("photo"),
  ).length;
  check(
    withPersonal >= 10,
    `only ${withPersonal} CVs have a personal details block`,
  );
  check(withPhoto >= 4, `only ${withPhoto} CVs have a photo`);
  check(
    new Set(manifest.cvs.map((c) => c.layout)).size >= 5,
    "fewer than 5 layouts",
  );
  check(manifest.cvs.filter((c) => c.isScan).length === 3, "expected 3 scans");
  check(
    manifest.cvs.filter((c) => c.noticeText === null).length >= 3,
    "too few CVs without notice period",
  );
  check(
    manifest.cvs.filter((c) => c.ctcText === null).length >= 3,
    "too few CVs without CTC",
  );
  check(
    manifest.cvs.filter((c) => c.email === null && c.phone === null).length ===
      1,
    "expected exactly one CV without contact details",
  );

  const { browser, page } = await openPage();
  try {
    check(
      await injectionIsInvisible(page),
      "prompt injection text changes the rendered page",
    );
  } finally {
    await browser.close();
  }

  if (failures.length)
    throw new Error(`verification failed:\n- ${failures.join("\n- ")}`);
  console.log(
    `verified ${manifest.cvs.length} CVs, ${manifest.jds.length} JDs, ${manifest.edge.length} edge files, ${(total / 1048576).toFixed(1)} MB`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  await verifyCorpus();
}
