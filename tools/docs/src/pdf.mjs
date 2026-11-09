/* global console, process, document */
// Renders docs/TDD.md to docs/Hireproof-TDD.pdf.
// Markdown becomes HTML with marked, Mermaid blocks are drawn to SVG inside
// Chromium, and Playwright prints the page as A4 with page numbers.
//   npm run docs:pdf
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { marked } from "marked";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const docs = path.resolve(here, "../../../docs");
const source = path.join(docs, "TDD.md");
const output = path.join(docs, "Hireproof-TDD.pdf");

const font = (pkg, file) =>
  pathToFileURL(
    path.join(
      path.dirname(require.resolve(`${pkg}/package.json`)),
      "files",
      file,
    ),
  ).href;
const faces = [
  ["Red Hat Text", "@fontsource/red-hat-text", "red-hat-text", 400],
  ["Red Hat Text", "@fontsource/red-hat-text", "red-hat-text", 500],
  ["Red Hat Display", "@fontsource/red-hat-display", "red-hat-display", 600],
  ["Red Hat Display", "@fontsource/red-hat-display", "red-hat-display", 700],
  ["Red Hat Mono", "@fontsource/red-hat-mono", "red-hat-mono", 400],
]
  .map(
    ([family, pkg, base, weight]) =>
      `@font-face{font-family:"${family}";font-weight:${weight};src:url("${font(pkg, `${base}-latin-${weight}-normal.woff2`)}") format("woff2")}`,
  )
  .join("\n");

// Print colours come from the design system, with the paper background off.
// The accent only draws the rule under section headings.
const css = `
${faces}
:root { --ink:#14110f; --muted:#58514c; --rule:#dbd7ce; --sunken:#f3f0e9; --accent:#fc6b33; }
@page { size: A4; margin: 15mm 15mm 17mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin:0; background:#fff; color:var(--ink); font:9pt/1.42 "Red Hat Text",sans-serif; }
h1,h2,h3 { font-family:"Red Hat Display",sans-serif; font-weight:600; letter-spacing:-0.02em; break-after:avoid; }
h1 { font-size:22pt; margin:0 0 4mm; padding-bottom:3mm; border-bottom:2.5pt solid var(--accent); }
h2 { font-size:14pt; margin:6.5mm 0 2.5mm; padding-bottom:1.5mm; border-bottom:1.5pt solid var(--accent); }
h3 { font-size:10.5pt; margin:4mm 0 1.2mm; }
p { margin:0 0 2.2mm; }
ul,ol { margin:0 0 2.6mm; padding-left:5mm; }
li { margin:0 0 .6mm; }
a { color:inherit; }
strong { font-weight:700; }
code { font-family:"Red Hat Mono",monospace; font-size:8pt; background:var(--sunken); padding:0 1mm; border-radius:1mm; }
pre { font-family:"Red Hat Mono",monospace; font-size:7.6pt; background:var(--sunken); border:.5pt solid var(--rule); border-radius:1.5mm; padding:2.5mm; white-space:pre-wrap; break-inside:avoid; }
pre code { background:none; padding:0; font-size:inherit; }
table { width:100%; border-collapse:collapse; margin:1.5mm 0 3.2mm; font-size:7.8pt; line-height:1.35; }
th { text-align:left; font-weight:700; border-bottom:1pt solid var(--ink); padding:.9mm 1.4mm; }
td { vertical-align:top; padding:.9mm 1.4mm; border-bottom:.5pt solid var(--rule); }
tr { break-inside:avoid; }
thead { display:table-header-group; }
img { display:block; max-width:118mm; max-height:74mm; margin:2mm auto 2mm; border:.5pt solid var(--rule); }
img[align=right] { float:right; max-width:none; max-height:none; width:52mm; margin:0 0 2mm 5mm; }
.mermaid { text-align:center; margin:2mm 0 3mm; break-inside:avoid; }
.mermaid svg { max-width:100%; max-height:95mm; height:auto; }
.cover-meta { color:var(--muted); font-size:9pt; margin-bottom:5mm; }
`;

function buildHtml() {
  const markdown = readFileSync(source, "utf8");
  const renderer = new marked.Renderer();
  const code = renderer.code.bind(renderer);
  renderer.code = (token) =>
    token.lang === "mermaid"
      ? `<pre class="mermaid">${token.text}</pre>`
      : code(token);
  const body = marked.parse(markdown, { renderer, gfm: true });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Hireproof: technical design</title>
<base href="${pathToFileURL(docs + path.sep).href}">
<style>${css}</style></head><body>${body}</body></html>`;
}

const footer = `<div style="width:100%;font:8px 'Helvetica Neue',Arial,sans-serif;color:#58514c;display:flex;justify-content:space-between;padding:0 15mm">
<span>Hireproof technical design</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;

const work = mkdtempSync(path.join(tmpdir(), "hireproof-pdf-"));
const htmlFile = path.join(work, "TDD.html");
writeFileSync(htmlFile, buildHtml());

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.error("page error:", err.message));
  await page.goto(pathToFileURL(htmlFile).href);
  await page.addScriptTag({
    path: require.resolve("mermaid/dist/mermaid.min.js"),
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
    // eslint-disable-next-line no-undef
    mermaid.initialize({
      startOnLoad: false,
      theme: "base",
      themeVariables: {
        fontFamily: '"Red Hat Text", sans-serif',
        fontSize: "15px",
        primaryColor: "#f3f0e9",
        primaryBorderColor: "#58514c",
        primaryTextColor: "#14110f",
        lineColor: "#58514c",
        secondaryColor: "#fed8c4",
        tertiaryColor: "#ffffff",
        edgeLabelBackground: "#ffffff",
      },
      flowchart: {
        htmlLabels: true,
        curve: "basis",
        nodeSpacing: 30,
        rankSpacing: 45,
        padding: 10,
      },
      er: { useMaxWidth: true },
    });
    // eslint-disable-next-line no-undef
    await mermaid.run({ querySelector: ".mermaid" });
  });
  const failed = await page.locator(".mermaid:not(:has(svg))").count();
  if (failed > 0)
    throw new Error(`${failed} Mermaid diagram(s) did not render`);
  const broken = await page.evaluate(() =>
    [...document.images]
      .filter((i) => !i.complete || i.naturalWidth === 0)
      .map((i) => i.src),
  );
  if (broken.length > 0)
    throw new Error(`Images did not load: ${broken.join(", ")}`);
  await page.pdf({
    path: output,
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: footer,
    margin: { top: "15mm", bottom: "17mm", left: "15mm", right: "15mm" },
  });
  console.log(`Wrote ${path.relative(process.cwd(), output)}`);
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}
