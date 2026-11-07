// Fields a scorer must never see. They stay in the original file and the raw
// extracted text, so a recruiter can still read the CV, but only the redacted
// text is ever sent for scoring.
const PERSONAL_LABEL =
  /^(?:date\s+of\s+birth|d\.?\s?o\.?\s?b\.?|birth\s*date|age|gender|sex|marital\s+status|father'?s?\s+name|mother'?s?\s+name|husband'?s?\s+name|religion|caste|nationality|passport(?:\s+(?:no\.?|number))?|languages?\s+known|known\s+languages)\s*(?:[:–-]|$)/i;

// "Languages: Java, Python" is a skills line, so a bare "Languages" label only
// counts when it lists spoken languages.
const SPOKEN_LANGUAGES_LINE =
  /^languages?\s*[:-]\s*(?:(?:english|hindi|marathi|tamil|telugu|kannada|malayalam|bengali|gujarati|punjabi|urdu|odia|assamese|french|german)\s*(?:,|and|&|\/|$)\s*)+$/i;

const PHOTO_LINE =
  /^\[?\s*(?:passport[\s-]+size\s+)?photo(?:graph)?\b[^\n]{0,30}$/i;

const EMAIL_ANYWHERE =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const PHONE_ANYWHERE =
  /(?<![\d.])(?:(?:\+|00)?91[\s.-]*)?0?[6-9]\d{4}[\s.-]?\d{5}(?!\d)|(?<![\d.])[6-9]\d{9}(?!\d)/g;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function isPersonalLine(line: string) {
  const text = line.trim();
  return (
    PERSONAL_LABEL.test(text) ||
    SPOKEN_LANGUAGES_LINE.test(text) ||
    PHOTO_LINE.test(text)
  );
}

// A label with nothing after it ("Date of Birth", then the value on the next
// line) is how table layouts come out of DOCX files.
const labelOnly = (line: string) =>
  PERSONAL_LABEL.test(line.trim()) &&
  line.trim().replace(PERSONAL_LABEL, "").trim() === "";

// `keepName` is for the text a client reads: contact and personal fields go,
// the name stays.
export function redact(
  text: string,
  name: string | null,
  options: { keepName?: boolean } = {},
): string {
  const kept: string[] = [];
  let dropNextValue = false;
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      kept.push(line);
      continue;
    }
    if (dropNextValue) {
      dropNextValue = false;
      if (!isPersonalLine(line) && line.trim().length < 80) continue;
    }
    if (isPersonalLine(line)) {
      dropNextValue = labelOnly(line);
      continue;
    }
    kept.push(line);
  }

  let out = kept
    .join("\n")
    .replace(EMAIL_ANYWHERE, "[email]")
    .replace(PHONE_ANYWHERE, "[phone]");

  const hidden = options.keepName ? [] : (name?.split(/\s+/) ?? []);
  for (const token of new Set(hidden)) {
    const clean = token.replace(/[^\p{L}'-]/gu, "");
    if (clean.length < 2) continue;
    out = out.replace(
      new RegExp(
        `(?<![\\p{L}\\p{N}])${escape(clean)}(?![\\p{L}\\p{N}])`,
        "giu",
      ),
      "[name]",
    );
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}
