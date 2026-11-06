import { ExtractError, extractText } from "../extract";
import { LOW_OCR_CONFIDENCE, needsOcr, ocrPdf } from "./ocr";

export type CvFailureCode =
  "unsupported" | "corrupt" | "encrypted" | "empty" | "unreadableScan";

export class CvExtractError extends Error {
  constructor(readonly code: CvFailureCode) {
    super(FAILURE_REASONS[code]);
  }
}

export const FAILURE_REASONS: Record<CvFailureCode, string> = {
  unsupported: "Only PDF and DOCX files are accepted.",
  corrupt: "This file is damaged and cannot be opened.",
  encrypted: "This PDF is password protected.",
  empty: "No text could be read from this file.",
  unreadableScan: "No readable CV content was found in this scan.",
};

export interface CvText {
  text: string;
  textSource: "TEXT_LAYER" | "OCR";
  ocrConfidence: number | null;
  reviewReasons: string[];
}

const ocrReason = "Scanned CV, text may be misread";

export async function extractCvText(
  buffer: Buffer,
  fileName: string,
  hooks: { ocr?: typeof ocrPdf; onOcr?: () => Promise<void> | void } = {},
): Promise<CvText> {
  const ocr = hooks.ocr ?? ocrPdf;
  let layer: { text: string; pages: number | null } | null = null;
  try {
    layer = await extractText(buffer, fileName);
  } catch (err) {
    if (!(err instanceof ExtractError)) throw err;
    // A PDF with no text at all is the plain case of a scan.
    const scan = err.code === "empty" && err.pages !== null;
    if (!scan) {
      throw new CvExtractError(
        err.code === "unreadable" ? "corrupt" : (err.code as CvFailureCode),
      );
    }
  }

  const sparsePdf = layer
    ? layer.pages !== null && needsOcr(layer.text, layer.pages)
    : true;
  if (layer && !sparsePdf) {
    return {
      text: layer.text,
      textSource: "TEXT_LAYER",
      ocrConfidence: null,
      reviewReasons: [],
    };
  }

  let scanned: { text: string; confidence: number };
  await hooks.onOcr?.();
  try {
    scanned = await ocr(buffer);
  } catch {
    if (layer) {
      return {
        text: layer.text,
        textSource: "TEXT_LAYER",
        ocrConfidence: null,
        reviewReasons: [],
      };
    }
    throw new CvExtractError("corrupt");
  }
  const text = scanned.text.trim();
  if (!text && !layer) throw new CvExtractError("empty");
  if (layer && text.length <= layer.text.length) {
    return {
      text: layer.text,
      textSource: "TEXT_LAYER",
      ocrConfidence: null,
      reviewReasons: [],
    };
  }
  return {
    text,
    textSource: "OCR",
    ocrConfidence: Math.round(scanned.confidence * 10) / 10,
    reviewReasons: scanned.confidence < LOW_OCR_CONFIDENCE ? [ocrReason] : [],
  };
}
