import { extname } from "node:path";
import mammoth from "mammoth";
import { extractText as pdfText, getDocumentProxy } from "unpdf";

export type ExtractErrorCode =
  "unsupported" | "empty" | "unreadable" | "encrypted";

export class ExtractError extends Error {
  constructor(
    readonly code: ExtractErrorCode,
    readonly pages: number | null = null,
  ) {
    super(code);
  }
}

export type Kind = "pdf" | "docx" | "txt";

const EXTENSIONS: Record<string, Kind> = {
  ".pdf": "pdf",
  ".docx": "docx",
  ".txt": "txt",
};

// The content decides what the file is; the extension has to agree with it.
function sniff(buffer: Buffer): Kind | null {
  if (buffer.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    return "docx";
  }
  return buffer.subarray(0, 8192).includes(0) ? null : "txt";
}

const tidy = (text: string) =>
  text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

async function readPdf(buffer: Buffer) {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text, totalPages } = await pdfText(pdf, { mergePages: true });
    return { text, pages: totalPages };
  } catch (err) {
    if (err instanceof Error && err.name === "PasswordException") {
      throw new ExtractError("encrypted");
    }
    throw new ExtractError("unreadable");
  }
}

async function readDocx(buffer: Buffer) {
  try {
    return (await mammoth.extractRawText({ buffer })).value;
  } catch {
    throw new ExtractError("unreadable");
  }
}

export async function extractText(
  buffer: Buffer,
  filename: string,
): Promise<{ text: string; pages: number | null; kind: Kind }> {
  const kind = sniff(buffer);
  if (!kind || EXTENSIONS[extname(filename).toLowerCase()] !== kind) {
    throw new ExtractError("unsupported");
  }
  let pages: number | null = null;
  let raw: string;
  if (kind === "pdf") {
    ({ text: raw, pages } = await readPdf(buffer));
  } else {
    raw = kind === "docx" ? await readDocx(buffer) : buffer.toString("utf8");
  }
  const text = tidy(raw);
  if (!text) throw new ExtractError("empty", pages);
  return { text, pages, kind };
}
