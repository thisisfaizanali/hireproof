import { PDFDocument } from "@cantoo/pdf-lib";
import { Document, Paragraph } from "docx";
import JSZip from "jszip";
import sharp from "sharp";
import type { Page } from "playwright";
import { htmlToPdf, stampDoc } from "./browser.js";
import { docOptions, packDocx } from "./docx.js";
import { esc } from "./html.js";
import { renderHtml } from "./layouts.js";
import { seeded } from "./rng.js";
import type { Candidate } from "./types.js";
import { make, ph, r } from "./data/helpers.js";

export const PDF_PASSWORD = "hireproof-sample";

export interface EdgeFile {
  file: string;
  format: "pdf" | "docx" | "odt";
  description: string;
  expectedOutcome: string;
  data: Uint8Array | Buffer;
}

/** A fictional person used only for the edge files. */
const edgePerson: Candidate = make(
  "none",
  null,
)({
  id: "CND-99001",
  name: "Vandana Rawal",
  email: "vandana.rawal@example.com",
  phone: ph(9001),
  city: "Gurugram",
  file: "edge",
  layout: "classic",
  fit: "poor",
  summary: {
    label: "Summary",
    text: "Operations professional with 6 years of experience in supply chain coordination and vendor management.",
  },
  roles: [
    r(
      "Supply Chain Coordinator",
      "Ardent Logistics",
      "Gurugram",
      "2020-11",
      "2023-05",
      [
        "Coordinated inbound shipments for 40 vendors and tracked delivery performance.",
      ],
    ),
    r(
      "Supply Chain Executive",
      "Kaveri Distribution",
      "Gurugram",
      "2023-05",
      "now",
      [
        "Plan weekly replenishment for 12 warehouses and report fill rates to the regional head.",
      ],
    ),
  ],
  education: [{ degree: "B.Com", institute: "Delhi University", year: "2020" }],
  skills: ["Vendor management", "Excel", "Inventory planning", "SAP (basic)"],
  canonicalSkills: ["Vendor management", "Excel", "Inventory planning", "SAP"],
});

const coverLetter =
  (): string => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Cover Letter</title><style>
*{margin:0;padding:0}body{font:11pt/1.6 Georgia,serif;padding:0 25mm;color:#222}@page{size:A4;margin:25mm 0}p{margin-bottom:12px}.r{text-align:right}</style></head><body>
<p class="r">12 October 2026</p>
<p>The Hiring Manager<br>Brightwater Packaging Pvt. Ltd.<br>Sector 62, Noida</p>
<p>Dear Sir or Madam,</p>
<p>${esc("I am writing to express my interest in the Procurement Executive position advertised on your careers page. I have long admired the way Brightwater Packaging has grown its sustainable packaging range, and I would be glad to contribute to that work.")}</p>
<p>${esc("I understand that my resume is attached separately. In this letter I would like to explain why I think the role suits me and why I believe a conversation would be worthwhile for both of us.")}</p>
<p>${esc("I am a quick learner, a good listener and someone who enjoys solving problems with a team. I am available for an interview at your convenience and can be reached on the number in my email signature.")}</p>
<p>Yours sincerely,<br>Sneha Iyer</p></body></html>`;

/** A PDF with real text on page one and a large scanned page behind it. */
async function largePdf(page: Page): Promise<Uint8Array> {
  const cv = await PDFDocument.load(
    await htmlToPdf(
      page,
      renderHtml({ ...edgePerson, name: "Kiran Bhat" }),
      "Kiran Bhat",
    ),
  );
  const rand = seeded(7);
  const w = 2600;
  const h = 3680;
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(rand() * 256);
  const jpg = await sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .jpeg({ quality: 93 })
    .toBuffer();
  const image = await cv.embedJpg(jpg);
  const extra = cv.addPage([595.28, 841.89]);
  extra.drawImage(image, { x: 0, y: 0, width: 595.28, height: 841.89 });
  stampDoc(cv, "Kiran Bhat");
  return cv.save();
}

async function odt(): Promise<Buffer> {
  const zip = new JSZip();
  const date = new Date("2026-10-15T09:00:00Z");
  const opts = { date, createFolders: false };
  zip.file("mimetype", "application/vnd.oasis.opendocument.text", {
    date,
    compression: "STORE",
  });
  zip.file(
    "META-INF/manifest.xml",
    `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`,
    opts,
  );
  const lines = [
    "Gaurav Sethi",
    "Retail Operations Executive",
    "Skills: inventory, billing, team coordination",
    "Experience: Store Executive, Greenleaf Mart, 2021 to date",
  ];
  zip.file(
    "content.xml",
    `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2"><office:body><office:text>${lines.map((l) => `<text:p>${esc(l)}</text:p>`).join("")}</office:text></office:body></office:document-content>`,
    opts,
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** Encryption draws random bytes; seeding them keeps the output identical between runs. */
async function encrypted(pdf: Uint8Array): Promise<Uint8Array> {
  const rand = seeded(99);
  const original = globalThis.crypto.getRandomValues;
  globalThis.crypto.getRandomValues = ((bytes: Uint8Array) => {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(rand() * 256);
    return bytes;
  }) as typeof original;
  try {
    const doc = await PDFDocument.load(pdf, { updateMetadata: false });
    doc.encrypt({
      userPassword: PDF_PASSWORD,
      ownerPassword: `${PDF_PASSWORD}-owner`,
      permissions: { printing: "highResolution", copying: false },
    });
    return await doc.save();
  } finally {
    globalThis.crypto.getRandomValues = original;
  }
}

export async function buildEdgeFiles(page: Page): Promise<EdgeFile[]> {
  const cvPdf = await htmlToPdf(page, renderHtml(edgePerson), edgePerson.name);

  const locked = await encrypted(cvPdf);

  return [
    {
      file: "Vandana_Rawal_Resume.pdf",
      format: "pdf",
      description:
        "A valid CV PDF cut off at 55% of its bytes, so the file cannot be opened.",
      expectedOutcome: "rejected: file is corrupt or unreadable",
      data: cvPdf.subarray(0, Math.floor(cvPdf.length * 0.55)),
    },
    {
      file: "Rajiv_Menon_CV.docx",
      format: "docx",
      description: "A valid DOCX with a single empty paragraph and no text.",
      expectedOutcome: "flagged: no text could be extracted from the document",
      data: await packDocx(
        new Document({
          ...docOptions("Rajiv Menon CV"),
          sections: [{ children: [new Paragraph("")] }],
        }),
      ),
    },
    {
      file: "Tarun_Bedi_Resume_protected.pdf",
      format: "pdf",
      description: `A CV PDF protected with the open password "${PDF_PASSWORD}".`,
      expectedOutcome: "rejected: password protected, text cannot be read",
      data: locked,
    },
    {
      file: "Cover_Letter_Sneha_Iyer.pdf",
      format: "pdf",
      description:
        "A readable cover letter that contains no experience, education or skills.",
      expectedOutcome: "flagged: text is readable but contains no CV content",
      data: await htmlToPdf(page, coverLetter(), "Cover Letter"),
    },
    {
      file: "Resume_Gaurav_Sethi.odt",
      format: "odt",
      description:
        "A short CV saved as OpenDocument text, a type the app does not accept.",
      expectedOutcome: "rejected: unsupported file type",
      data: await odt(),
    },
    {
      file: "Kiran_Bhat_Resume_with_certificates.pdf",
      format: "pdf",
      description:
        "A valid CV PDF of about 9 MB: a text page followed by a full page image.",
      expectedOutcome:
        "accepted or rejected by the upload size limit; valid file of about 9 MB",
      data: await largePdf(page),
    },
  ];
}
