import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { A4_PX, htmlToPages, openPage, SCAN_SCALE } from "./browser.js";
import { candidates } from "./data/index.js";
import { renderHtml } from "./layouts.js";
import { degrade } from "./scan.js";

/** First pages of a few layouts and one scan, for the pull request description. */
const OUT = resolve(import.meta.dirname, "../../../docs/screenshots/corpus");
const WANTED = [
  "Ritika_Bansal_Resume.pdf",
  "Tanvi Joshi Resume 2026.pdf",
  "Pooja Nair CV.pdf",
  "Sridhar_V_Architect_CV.pdf",
  "Ananya P - Resume.pdf",
];

mkdirSync(OUT, { recursive: true });
const { browser, page } = await openPage();
const scanPage = await browser.newPage({
  viewport: A4_PX,
  deviceScaleFactor: SCAN_SCALE,
});

try {
  for (const file of WANTED) {
    const c = candidates.find((x) => x.file === file)!;
    const [first] = await htmlToPages(page, renderHtml(c, true));
    writeFileSync(join(OUT, `${c.layout}.png`), first);
  }
  const scan = candidates.find((x) => x.scan === "tilted")!;
  const [shot] = await htmlToPages(scanPage, renderHtml(scan, true));
  const jpeg = await degrade(shot, "tilted", scan.id);
  writeFileSync(
    join(OUT, "scan.png"),
    await sharp(jpeg).resize(794).png().toBuffer(),
  );
} finally {
  await browser.close();
}
