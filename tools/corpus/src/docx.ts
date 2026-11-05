import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Tab,
  TabStopPosition,
  TabStopType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from "docx";
import JSZip from "jszip";
import sharp from "sharp";
import {
  availabilityLines,
  contactParts,
  dateRange,
  experienceYearsLine,
  personalRows,
  silhouetteSvg,
} from "./html.js";
import type { Candidate } from "./types.js";

const FIXED_DATE = new Date("2026-10-15T09:00:00Z");
const BULLETS = "bullets";

/** Zip the document with fixed timestamps so that reruns match byte for byte. */
export async function packDocx(doc: Document): Promise<Buffer> {
  const zip = await JSZip.loadAsync(await Packer.toBuffer(doc));
  const iso = FIXED_DATE.toISOString().replace(/\.\d+Z$/, "Z");
  const core = await zip.file("docProps/core.xml")!.async("string");
  zip.file(
    "docProps/core.xml",
    core.replace(/(<dcterms:(?:created|modified)[^>]*>)[^<]*/g, `$1${iso}`),
  );
  zip.forEach((_, file) => {
    file.date = FIXED_DATE;
  });
  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
}

export const docOptions = (title: string) => ({
  title,
  creator: "",
  lastModifiedBy: "",
  description: "",
  numbering: {
    config: [
      {
        reference: BULLETS,
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: "•",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 400, hanging: 240 } } },
          },
        ],
      },
    ],
  },
});

interface RunOpts {
  bold?: boolean;
  italics?: boolean;
  size?: number;
  color?: string;
  font?: string;
}
export const run = (text: string, o: RunOpts = {}) =>
  new TextRun({ text, font: o.font ?? "Calibri", size: o.size ?? 21, ...o });
export const para = (
  text: string,
  o: RunOpts & {
    align?: (typeof AlignmentType)[keyof typeof AlignmentType];
    after?: number;
  } = {},
) =>
  new Paragraph({
    children: [run(text, o)],
    alignment: o.align,
    spacing: { after: o.after ?? 60 },
  });
export const bullet = (text: string, o: RunOpts = {}) =>
  new Paragraph({
    children: [run(text, o)],
    numbering: { reference: BULLETS, level: 0 },
    spacing: { after: 40 },
  });

const heading = (title: string, font = "Calibri") =>
  new Paragraph({
    children: [run(title.toUpperCase(), { bold: true, size: 22, font })],
    spacing: { before: 220, after: 80 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: "808080", space: 2 },
    },
  });

const eduLine = (c: Candidate) =>
  c.education.map(
    (e) =>
      `${e.degree}, ${e.institute}, ${e.year}${e.score ? ` (${e.score})` : ""}`,
  );

function docxClassic(c: Candidate): Document {
  const font = "Cambria";
  const o = { font };
  const kids: (Paragraph | Table)[] = [
    para(c.name, {
      bold: true,
      size: 36,
      align: AlignmentType.CENTER,
      after: 40,
      ...o,
    }),
    para(contactParts(c).join("  |  "), {
      align: AlignmentType.CENTER,
      after: 120,
      ...o,
    }),
  ];
  if (c.headline)
    kids.push(
      para(c.headline, { bold: true, align: AlignmentType.CENTER, ...o }),
    );
  if (c.summary)
    kids.push(heading(c.summary.label, font), para(c.summary.text, o));
  if (c.roles.length) kids.push(heading("Professional Experience", font));
  for (const r of [...c.roles].reverse()) {
    kids.push(
      new Paragraph({
        children: [
          run(r.title, { bold: true, ...o }),
          run(`, ${r.company}, ${r.city}`, o),
          new TextRun({
            children: [new Tab(), dateRange(r, c.dateStyle)],
            font,
            size: 21,
            italics: true,
          }),
        ],
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        spacing: { before: 100, after: 40 },
        keepNext: true,
      }),
      ...r.bullets.map((b) => bullet(b, o)),
    );
  }
  kids.push(heading("Education", font), ...eduLine(c).map((l) => bullet(l, o)));
  kids.push(heading("Skills", font), para(c.skills.join(", "), o));
  if (c.certifications)
    kids.push(
      heading("Certifications", font),
      ...c.certifications.map((l) => bullet(l, o)),
    );
  const rows = personalRows(c);
  if (rows.length)
    kids.push(
      heading("Personal Details", font),
      ...rows.map(([k, v]) => para(`${k}: ${v}`, o)),
    );
  const extra = [...availabilityLines(c), experienceYearsLine(c)].filter(
    Boolean,
  );
  if (extra.length)
    kids.push(
      heading("Additional Information", font),
      ...extra.map((l) => para(l, o)),
    );
  return new Document({
    ...docOptions(c.name),
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1000, bottom: 1000, left: 1200, right: 1200 },
          },
        },
        children: kids,
      },
    ],
  });
}

const THIN = { style: BorderStyle.SINGLE, size: 4, color: "8C8C8C" };
const BORDERS = {
  top: THIN,
  bottom: THIN,
  left: THIN,
  right: THIN,
  insideHorizontal: THIN,
  insideVertical: THIN,
};

const cell = (
  kids: Paragraph[],
  width: number,
  opts: { head?: boolean; span?: number } = {},
) =>
  new TableCell({
    children: kids,
    width: { size: width, type: WidthType.DXA },
    columnSpan: opts.span,
    margins: { top: 50, bottom: 50, left: 100, right: 100 },
    shading: opts.head
      ? { type: ShadingType.CLEAR, fill: "DCE6F1", color: "auto" }
      : undefined,
  });

const table = (widths: number[], rows: TableRow[]) =>
  new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    borders: BORDERS,
    rows,
  });

const tp = (text: string, o: RunOpts = {}) =>
  para(text, { size: 20, after: 20, ...o });

async function photoParagraph(c: Candidate): Promise<Paragraph> {
  const png = await sharp(Buffer.from(silhouetteSvg(c, 240)))
    .png()
    .toBuffer();
  return new Paragraph({
    alignment: AlignmentType.RIGHT,
    children: [
      new ImageRun({
        type: "png",
        data: png,
        transformation: { width: 88, height: 88 },
        altText: {
          title: "Photograph",
          description: "Photograph placeholder",
          name: "photo",
        },
      }) as ParagraphChild,
    ],
  });
}

async function docxTable(c: Candidate): Promise<Document> {
  const W = [2400, 2600, 1900, 2700];
  const kids: (Paragraph | Table)[] = [
    para("CURRICULUM VITAE", {
      bold: true,
      size: 30,
      align: AlignmentType.CENTER,
      after: 160,
    }),
    table(
      [6600, 3000],
      [
        new TableRow({
          children: [
            cell(
              [
                tp(c.name.toUpperCase(), { bold: true, size: 26 }),
                ...(c.email ? [tp(`Email: ${c.email}`)] : []),
                ...(c.phone ? [tp(`Mobile: ${c.phone}`)] : []),
                tp(`Location: ${c.city}`),
                ...(c.statedExperience
                  ? [tp(`Total Experience: ${c.statedExperience}`)]
                  : []),
              ],
              6600,
            ),
            cell([c.photo ? await photoParagraph(c) : tp("")], 3000),
          ],
        }),
      ],
    ),
  ];
  if (c.summary) kids.push(heading(c.summary.label), para(c.summary.text));

  kids.push(heading("Personal Details"));
  const rows = personalRows(c).map(
    ([k, v]) =>
      new TableRow({
        children: [
          cell([tp(k, { bold: true })], 3000, { head: true }),
          cell([tp(v)], 6600),
        ],
      }),
  );
  const extra = availabilityLines(c);
  if (extra.length) {
    rows.push(
      new TableRow({
        children: [
          cell([tp("Availability and Salary", { bold: true })], 3000, {
            head: true,
          }),
          cell(
            extra.map((l) => tp(l)),
            6600,
          ),
        ],
      }),
    );
  }
  kids.push(table([3000, 6600], rows));

  kids.push(heading("Technical Skills"));
  const skillRows: TableRow[] = [];
  for (let i = 0; i < c.skills.length; i += 3) {
    const chunk = c.skills.slice(i, i + 3);
    skillRows.push(
      new TableRow({
        children: [0, 1, 2].map((j) => cell([tp(chunk[j] ?? "")], 3200)),
      }),
    );
  }
  kids.push(table([3200, 3200, 3200], skillRows));

  kids.push(heading("Employment History"));
  kids.push(
    table(W, [
      new TableRow({
        tableHeader: true,
        children: [
          "Organisation",
          "Designation",
          "Duration",
          "Key Responsibilities",
        ].map((t, i) => cell([tp(t, { bold: true })], W[i], { head: true })),
      }),
      ...[...c.roles].reverse().map(
        (r) =>
          new TableRow({
            cantSplit: true,
            children: [
              cell([tp(r.company), tp(r.city, { italics: true })], W[0]),
              cell([tp(r.title)], W[1]),
              cell([tp(dateRange(r, c.dateStyle))], W[2]),
              cell(
                r.bullets.map((b) => bullet(b, { size: 19 })),
                W[3],
              ),
            ],
          }),
      ),
    ]),
  );

  kids.push(heading("Educational Qualification"));
  const EW = [3200, 3600, 1000, 1800];
  kids.push(
    table(EW, [
      new TableRow({
        children: ["Qualification", "Institute", "Year", "Score"].map((t, i) =>
          cell([tp(t, { bold: true })], EW[i], { head: true }),
        ),
      }),
      ...c.education.map(
        (e) =>
          new TableRow({
            children: [e.degree, e.institute, e.year, e.score ?? "-"].map(
              (t, i) => cell([tp(t)], EW[i]),
            ),
          }),
      ),
    ]),
  );
  if (c.certifications)
    kids.push(
      heading("Certifications"),
      ...c.certifications.map((l) => bullet(l)),
    );

  kids.push(
    heading("Declaration"),
    para(
      "I hereby declare that the above information is true and correct to the best of my knowledge and belief.",
    ),
    para(`Place: ${c.city}`),
    para(`(${c.name})`, { align: AlignmentType.RIGHT }),
  );
  return new Document({
    ...docOptions(c.name),
    sections: [
      {
        properties: {
          page: { margin: { top: 900, bottom: 900, left: 1150, right: 1150 } },
        },
        children: kids,
      },
    ],
  });
}

export async function renderDocx(c: Candidate): Promise<Buffer> {
  if (c.layout === "docx-classic") return packDocx(docxClassic(c));
  if (c.layout === "table-indian") return packDocx(await docxTable(c));
  throw new Error(`${c.file}: ${c.layout} is not a DOCX layout`);
}

export { heading };
