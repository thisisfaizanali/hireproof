import { AlignmentType, Document, Paragraph } from "docx";
import type { Page } from "playwright";
import { htmlToPdf } from "./browser.js";
import { bullet, docOptions, heading, packDocx, para, run } from "./docx.js";
import { esc } from "./html.js";
import type { Jd, JdBlock } from "./types.js";

function jdDocx(jd: Jd): Promise<Buffer> {
  const kids: Paragraph[] = [];
  const [first, ...rest] = jd.blocks as JdBlock[];
  if ("h" in first) {
    kids.push(
      new Paragraph({
        children: [run(first.h, { bold: true, size: 34, color: "1F3A4D" })],
        alignment: AlignmentType.LEFT,
        spacing: { after: 120 },
      }),
    );
  }
  for (const b of rest) {
    if ("h" in b) kids.push(heading(b.h));
    else if ("p" in b) kids.push(para(b.p));
    else kids.push(...b.ul.map((t) => bullet(t)));
  }
  return packDocx(
    new Document({
      ...docOptions(jd.title),
      sections: [
        {
          properties: {
            page: {
              margin: { top: 1100, bottom: 1100, left: 1300, right: 1300 },
            },
          },
          children: kids,
        },
      ],
    }),
  );
}

function jdHtml(jd: Jd): string {
  const body = (jd.blocks as JdBlock[])
    .map((b) =>
      "h" in b
        ? `<h2>${esc(b.h)}</h2>`
        : "p" in b
          ? `<p>${esc(b.p)}</p>`
          : `<ul>${b.ul.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(jd.title)}</title><style>
*{box-sizing:border-box;margin:0;padding:0}body{font:10.5pt/1.5 Calibri,Arial,sans-serif;color:#222;padding:0 22mm}
@page{size:A4;margin:20mm 0}h2{font-size:12pt;color:#12507a;margin:16px 0 5px;border-bottom:1px solid #b8c7d3;padding-bottom:2px}
h2:first-child{font-size:20pt;border:0;color:#12507a}ul{padding-left:1.2em}li{margin-bottom:.25em}</style></head><body>${body}</body></html>`;
}

export async function renderJd(
  jd: Jd,
  page: Page,
): Promise<Buffer | Uint8Array | string> {
  if (jd.format === "docx") return jdDocx(jd);
  if (jd.format === "pdf") return htmlToPdf(page, jdHtml(jd), jd.title);
  return jd.text as string;
}
