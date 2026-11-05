import {
  availabilityLines,
  contactParts,
  dateRange,
  esc,
  experienceYearsLine,
  hiddenInjection,
  personalRows,
  silhouetteSvg,
} from "./html.js";
import type { Candidate, Layout } from "./types.js";

const BASE = `*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#fff}
body{position:relative;color:#1b1b1b;-webkit-print-color-adjust:exact;print-color-adjust:exact}
ul{padding-left:1.1em}li{margin:0 0 .22em}
@page{size:A4;margin:14mm 0}`;

const reversed = (c: Candidate) => [...c.roles].reverse();
const bullets = (items: string[]) =>
  `<ul>${items.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`;
const page = (c: Candidate, css: string, body: string, scan: boolean) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(c.name)}</title><style>${BASE}${
    scan ? "body{padding-top:14mm;padding-bottom:14mm}" : ""
  }${css}</style></head><body>${body}${hiddenInjection(c)}</body></html>`;

function eduItems(c: Candidate) {
  return c.education.map(
    (e) =>
      `${esc(e.degree)}, ${esc(e.institute)}, ${esc(e.year)}${e.score ? ` (${esc(e.score)})` : ""}`,
  );
}

function extrasHtml(c: Candidate, h: (t: string) => string) {
  return (c.extras ?? []).map((x) => h(x.title) + bullets(x.items)).join("");
}

function projectsHtml(c: Candidate) {
  return (c.projects ?? [])
    .map((p) => `<p class="proj"><b>${esc(p.name)}</b><br>${esc(p.desc)}</p>`)
    .join("");
}

function roleBlock(c: Candidate, cls = "role") {
  return reversed(c)
    .map(
      (r) =>
        `<div class="${cls}"><div class="rh"><span><b>${esc(r.title)}</b>, ${esc(r.company)}, ${esc(r.city)}</span><span class="dt">${esc(dateRange(r, c.dateStyle))}</span></div>${bullets(r.bullets)}</div>`,
    )
    .join("");
}

function classic(c: Candidate, scan: boolean) {
  const h = (t: string) => `<h2>${esc(t)}</h2>`;
  const extra = [...availabilityLines(c), experienceYearsLine(c)].filter(
    Boolean,
  );
  const body = `<div class="wrap">
<h1>${esc(c.name)}</h1>
<p class="contact">${contactParts(c).map(esc).join("  |  ")}</p>
${c.summary ? h(c.summary.label) + `<p>${esc(c.summary.text)}</p>` : ""}
${c.roles.length ? h("Work Experience") + roleBlock(c) : ""}
${c.projects ? h("Projects") + projectsHtml(c) : ""}
${h("Education")}${bullets(eduItems(c))}
${h("Skills")}<p>${c.skills.map(esc).join(", ")}</p>
${c.certifications ? h("Certifications") + bullets(c.certifications) : ""}
${extrasHtml(c, h)}
${
  personalRows(c).length
    ? h("Personal Details") +
      personalRows(c)
        .map(([k, v]) => `<p>${k}: ${esc(v)}</p>`)
        .join("")
    : ""
}
${extra.length ? h("Additional Information") + extra.map((l) => `<p>${esc(l)}</p>`).join("") : ""}
</div>`;
  return page(
    c,
    `body{font:10.5pt/1.4 Georgia,'Times New Roman',serif}
.wrap{padding:0 18mm}
h1{font-size:23pt;text-align:center;letter-spacing:.5px;font-weight:600}
.contact{text-align:center;font-size:9.5pt;color:#444;margin:3px 0 10px;border-bottom:1.5px solid #222;padding-bottom:8px}
h2{font-size:10.5pt;text-transform:uppercase;letter-spacing:1.2px;border-bottom:1px solid #999;margin:13px 0 6px;padding-bottom:2px}
.rh{display:flex;justify-content:space-between;gap:12px;margin-top:6px}.dt{white-space:nowrap;color:#444;font-style:italic}
.role{break-inside:avoid}.proj{margin-bottom:5px}`,
    body,
    scan,
  );
}

function sidebar(c: Candidate, scan: boolean) {
  const h = (t: string) => `<h2>${esc(t)}</h2>`;
  const side = `<aside>
${c.photo ? `<div class="ph">${silhouetteSvg(c, 130)}</div>` : ""}
<h3>Contact</h3>${contactParts(c)
    .map((x) => `<p>${esc(x)}</p>`)
    .join("")}
<h3>Skills</h3><ul>${c.skills.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
${
  personalRows(c).length
    ? "<h3>Personal</h3>" +
      personalRows(c)
        .map(([k, v]) => `<p><small>${k}</small><br>${esc(v)}</p>`)
        .join("")
    : ""
}
${
  availabilityLines(c).length
    ? "<h3>Availability</h3>" +
      availabilityLines(c)
        .map((l) => `<p>${esc(l)}</p>`)
        .join("")
    : ""
}
</aside>`;
  const main = `<main>
<h1>${esc(c.name)}</h1>${c.headline ? `<div class="hl">${esc(c.headline)}</div>` : ""}
${c.summary ? h(c.summary.label) + `<p>${esc(c.summary.text)}</p>` : ""}
${c.roles.length ? h("Experience") + roleBlock(c) : ""}
${h("Education")}${bullets(eduItems(c))}
${c.certifications ? h("Certifications") + bullets(c.certifications) : ""}
${extrasHtml(c, h)}
</main>`;
  return page(
    c,
    `@page{margin:0}body{font:10pt/1.4 'Segoe UI',Calibri,Arial,sans-serif;display:grid;grid-template-columns:68mm 1fr;min-height:296mm;background:linear-gradient(to right,#1f3a4d 68mm,#fff 68mm)}
aside{color:#e8eef2;padding:16mm 8mm}main{padding:16mm 12mm 12mm 12mm}
aside h3{font-size:9pt;text-transform:uppercase;letter-spacing:1.5px;color:#9fc3d6;margin:14px 0 5px}
aside p{font-size:9pt;margin-bottom:4px;word-break:break-all}aside small{color:#9fc3d6}aside ul{list-style:none;padding:0}aside li{font-size:9pt;margin-bottom:3px}
.ph svg{border-radius:50%;display:block;margin:0 auto 6px;width:34mm;height:34mm}
h1{font-size:25pt;font-weight:700;color:#1f3a4d;line-height:1.1}.hl{font-size:12pt;color:#4a6a7d;margin:3px 0 8px}
h2{font-size:10pt;text-transform:uppercase;letter-spacing:1.5px;color:#1f3a4d;margin:14px 0 5px;border-bottom:2px solid #1f3a4d;display:inline-block}
.rh{display:flex;justify-content:space-between;gap:10px;margin-top:6px}.dt{color:#555;white-space:nowrap;font-size:9pt}`,
    side + main,
    scan,
  );
}
function minimal(c: Candidate, scan: boolean) {
  const row = (label: string, inner: string) =>
    `<section><div class="lb">${esc(label)}</div><div>${inner}</div></section>`;
  const extra = [...availabilityLines(c), experienceYearsLine(c)].filter(
    Boolean,
  );
  const body = `<div class="wrap">
<header><h1>${esc(c.name)}</h1>${c.headline ? `<div class="hl">${esc(c.headline)}</div>` : ""}<div class="ct">${contactParts(c).map(esc).join("<br>")}</div></header>
${c.summary ? row(c.summary.label, `<p>${esc(c.summary.text)}</p>`) : ""}
${c.roles.length ? row("Experience", roleBlock(c)) : ""}
${row("Education", bullets(eduItems(c)))}
${row("Skills", `<p>${c.skills.map(esc).join("  /  ")}</p>`)}
${c.certifications ? row("Certifications", bullets(c.certifications)) : ""}
${
  personalRows(c).length
    ? row(
        "Personal",
        personalRows(c)
          .map(([k, v]) => `<p>${k}: ${esc(v)}</p>`)
          .join(""),
      )
    : ""
}
${extra.length ? row("Details", extra.map((l) => `<p>${esc(l)}</p>`).join("")) : ""}
</div>`;
  return page(
    c,
    `body{font:10pt/1.5 'Segoe UI',Calibri,Arial,sans-serif;color:#222}
.wrap{padding:0 20mm}header{display:grid;grid-template-columns:42mm 1fr;margin-bottom:6mm}
h1{font-size:26pt;font-weight:300;letter-spacing:-.5px;grid-column:1 / 3}.hl{grid-column:1 / 3;color:#666;margin:2px 0 8px}.ct{grid-column:2;font-size:9pt;color:#555}
section{display:grid;grid-template-columns:42mm 1fr;padding:9px 0;border-top:1px solid #e3e3e3}
.lb{font-size:8pt;text-transform:uppercase;letter-spacing:2px;color:#888;padding-top:2px}
.rh{display:flex;justify-content:space-between;margin-top:5px;gap:10px}.dt{color:#777;font-size:9pt;white-space:nowrap}.role{break-inside:avoid}`,
    body,
    scan,
  );
}

function dense(c: Candidate, scan: boolean) {
  const h = (t: string) => `<h2>${esc(t)}</h2>`;
  const extra = [...availabilityLines(c), experienceYearsLine(c)].filter(
    Boolean,
  );
  const body = `<div class="wrap">
<div class="top"><h1>${esc(c.name)}</h1><div class="ctr">${contactParts(c).map(esc).join(" | ")}</div></div>
${c.headline ? `<div class="hl">${esc(c.headline)}</div>` : ""}
${c.summary ? h(c.summary.label) + `<p>${esc(c.summary.text)}</p>` : ""}
${h("Core Competencies")}<div class="cols">${c.skills.map((s) => `<span>${esc(s)}</span>`).join("")}</div>
${h("Professional Experience")}${roleBlock(c)}
${extrasHtml(c, h)}
${h("Education")}${bullets(eduItems(c))}
${c.certifications ? h("Certifications") + bullets(c.certifications) : ""}
${
  personalRows(c).length
    ? h("Personal Details") +
      `<div class="cols two">${personalRows(c)
        .map(([k, v]) => `<span>${k}: ${esc(v)}</span>`)
        .join("")}</div>`
    : ""
}
${extra.length ? h("Additional Information") + extra.map((l) => `<p>${esc(l)}</p>`).join("") : ""}
</div>`;
  return page(
    c,
    `body{font:10.5pt/1.6 Calibri,Arial,sans-serif}.wrap{padding:0 16mm}li{margin-bottom:.45em}
.top{display:flex;justify-content:space-between;align-items:baseline;border-bottom:3px solid #14365d;padding-bottom:4px}
h1{font-size:22pt;color:#14365d}.ctr{font-size:9pt;color:#444}.hl{font-size:12pt;font-weight:600;margin:5px 0}
h2{background:#14365d;color:#fff;font-size:9.5pt;text-transform:uppercase;letter-spacing:1px;padding:3px 8px;margin:14px 0 7px}
.cols{display:grid;grid-template-columns:1fr 1fr 1fr;gap:3px 12px;font-size:9.5pt}.cols.two{grid-template-columns:1fr 1fr}
.rh{display:flex;justify-content:space-between;margin-top:8px;border-bottom:1px dotted #aaa;padding-bottom:2px}.dt{font-weight:600;white-space:nowrap}
.role{break-inside:avoid;margin-bottom:6px}`,
    body,
    scan,
  );
}

function fresher(c: Candidate, scan: boolean) {
  const h = (t: string) => `<h2>${esc(t)}</h2>`;
  const extra = availabilityLines(c);
  const body = `<div class="wrap">
<div class="head"><div><h1>${esc(c.name)}</h1><p>${contactParts(c).map(esc).join("<br>")}</p></div>${c.photo ? silhouetteSvg(c, 100) : ""}</div>
${c.summary ? h(c.summary.label) + `<p>${esc(c.summary.text)}</p>` : ""}
${h("Projects and Internships")}${projectsHtml(c)}
${h("Education")}${bullets(eduItems(c))}
${h("Technical and Other Skills")}<p>${c.skills.map(esc).join(", ")}</p>
${c.certifications ? h("Certifications") + bullets(c.certifications) : ""}
${
  personalRows(c).length
    ? h("Personal Details") +
      personalRows(c)
        .map(([k, v]) => `<p>${k} : ${esc(v)}</p>`)
        .join("")
    : ""
}
${extra.length ? extra.map((l) => `<p>${esc(l)}</p>`).join("") : ""}
<p class="decl">I hereby declare that the information given above is true to the best of my knowledge.</p>
</div>`;
  return page(
    c,
    `body{font:10pt/1.4 Arial,Helvetica,sans-serif}.wrap{padding:0 16mm}
.head{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #b5483a;padding-bottom:8px}
.head svg{width:26mm;height:26mm;border:1px solid #ccc}h1{font-size:22pt;color:#b5483a}.head p{font-size:9.5pt;color:#444;margin-top:3px}
h2{font-size:10.5pt;color:#b5483a;text-transform:uppercase;margin:12px 0 5px}.proj{margin-bottom:6px}.decl{margin-top:14px;font-size:9pt;color:#555}`,
    body,
    scan,
  );
}

const html: Partial<Record<Layout, (c: Candidate, scan: boolean) => string>> = {
  classic,
  sidebar,
  minimal,
  dense,
  fresher,
};

export function renderHtml(c: Candidate, scan = false): string {
  const fn = html[c.layout];
  if (!fn) throw new Error(`${c.file}: ${c.layout} is not an HTML layout`);
  return fn(c, scan);
}
