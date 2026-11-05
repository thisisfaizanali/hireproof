import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "@cantoo/pdf-lib";
import {
  A4_PX,
  htmlToPages,
  htmlToPdf,
  openPage,
  SCAN_SCALE,
} from "./browser.js";
import { candidates, jds } from "./data/index.js";
import { renderDocx } from "./docx.js";
import { buildEdgeFiles } from "./edge.js";
import { renderJd } from "./jd.js";
import { renderHtml } from "./layouts.js";
import { buildManifest } from "./manifest.js";
import { degrade, imagesToPdf } from "./scan.js";
import { SAMPLES, verifyCorpus } from "./verify.js";

const PHOTO_LAYOUTS = new Set(["sidebar", "fresher", "table-indian"]);
const EM_DASH = String.fromCodePoint(0x2014);

if (JSON.stringify([candidates, jds]).includes(EM_DASH)) {
  throw new Error("source data contains an em dash");
}
for (const c of candidates) {
  if (c.photo && !PHOTO_LAYOUTS.has(c.layout)) {
    throw new Error(`${c.file}: layout ${c.layout} cannot show a photo`);
  }
}

for (const dir of ["jds", "cvs", "edge"]) {
  rmSync(join(SAMPLES, dir), { recursive: true, force: true });
  mkdirSync(join(SAMPLES, dir), { recursive: true });
}
rmSync(join(SAMPLES, "manifest.json"), { force: true });

const { browser, page } = await openPage();
const scanPage = await browser.newPage({
  viewport: A4_PX,
  deviceScaleFactor: SCAN_SCALE,
});

try {
  for (const jd of jds) {
    writeFileSync(join(SAMPLES, "jds", jd.file), await renderJd(jd, page));
  }

  const cvs: {
    candidate: (typeof candidates)[number];
    pages: number | null;
  }[] = [];
  for (const c of candidates) {
    let data: Uint8Array | Buffer;
    let pages: number | null = null;
    if (c.file.endsWith(".docx")) {
      data = await renderDocx(c);
    } else if (c.scan) {
      const shots = await htmlToPages(scanPage, renderHtml(c, true));
      const scans = await Promise.all(
        shots.map((s) => degrade(s, c.scan!, c.id)),
      );
      data = await imagesToPdf(scans, c.name);
      pages = shots.length;
    } else {
      data = await htmlToPdf(page, renderHtml(c), c.name);
      pages = (await PDFDocument.load(data)).getPageCount();
    }
    writeFileSync(join(SAMPLES, "cvs", c.file), data);
    cvs.push({ candidate: c, pages });
  }

  const edge = await buildEdgeFiles(page);
  for (const e of edge) writeFileSync(join(SAMPLES, "edge", e.file), e.data);

  const manifest = buildManifest(jds, cvs, edge);
  writeFileSync(
    join(SAMPLES, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
} finally {
  await browser.close();
}

await verifyCorpus();
