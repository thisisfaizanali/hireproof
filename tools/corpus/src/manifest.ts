import { z } from "zod";
import { totalExperienceYears, AS_OF } from "./experience.js";
import { PERSONAL_FIELDS, type Candidate, type Jd } from "./types.js";
import type { EdgeFile } from "./edge.js";

const personalField = z.enum([...PERSONAL_FIELDS, "photo"]);
const fit = z.enum(["strong", "partial", "poor"]);
const lpa = z.number().positive().nullable();

const cvEntry = z.object({
  file: z.string(),
  format: z.enum(["pdf", "docx"]),
  layout: z.string(),
  isScan: z.boolean(),
  /** Null for DOCX, where the page count depends on the word processor. */
  pages: z.number().int().positive().nullable(),
  candidateId: z.string().regex(/^CND-9\d{4}$/),
  duplicateGroup: z
    .object({ key: z.string(), kind: z.enum(["exact", "contact", "fuzzy"]) })
    .nullable(),
  pool: z.enum(["java", "kyc", "retail", "none"]),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  currentRole: z.string(),
  totalExperienceYears: z.number().min(0),
  statedExperience: z.string().nullable(),
  skills: z.array(z.string()),
  noticeText: z.string().nullable(),
  noticeDays: z.number().int().min(0).nullable(),
  ctcText: z.string().nullable(),
  currentCtcLpa: lpa,
  expectedCtcLpa: lpa,
  location: z.string(),
  personalFieldsPresent: z.array(personalField),
  intendedRequisition: z.string().nullable(),
  expectedFit: fit,
  adversarial: z.enum(["promptInjection", "keywordStuffing"]).nullable(),
});

const jdEntry = z.object({
  file: z.string(),
  format: z.enum(["pdf", "docx", "txt"]),
  key: z.string(),
  client: z.string(),
  title: z.string(),
  mustHaveSkills: z.array(z.string()),
  niceToHaveSkills: z.array(z.string()),
  experienceMinYears: z.number().nullable(),
  experienceMaxYears: z.number().nullable(),
  locations: z.array(z.string()),
  noticeMaxDays: z.number().int().nullable(),
  ctcBudgetLpa: z.object({ min: z.number(), max: z.number() }).nullable(),
  ambiguity: z.array(z.string()),
});

const edgeEntry = z.object({
  file: z.string(),
  format: z.enum(["pdf", "docx", "odt"]),
  description: z.string(),
  expectedOutcome: z.string(),
});

const BRIEF = [
  {
    id: "CND-91022",
    name: "Ritika Bansal",
    role: "Senior Java Developer",
    years: 6.5,
    notice: 60,
  },
  {
    id: "CND-91047",
    name: "Arjun Rawat",
    role: "KYC Analyst",
    years: 3,
    notice: 30,
  },
  {
    id: "CND-91088",
    name: "Pooja Nair",
    role: "Java Developer",
    years: 4,
    notice: 90,
  },
];

export const manifestSchema = z
  .object({
    asOf: z.string(),
    note: z.string(),
    jds: z.array(jdEntry),
    cvs: z.array(cvEntry),
    edge: z.array(edgeEntry),
  })
  .superRefine((m, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    const files = [...m.jds, ...m.cvs, ...m.edge].map((e) => e.file);
    if (new Set(files).size !== files.length) fail("file names are not unique");

    const jdKeys = new Set(m.jds.map((j) => j.key));
    for (const c of m.cvs) {
      if (c.intendedRequisition && !jdKeys.has(c.intendedRequisition)) {
        fail(`${c.file}: unknown requisition ${c.intendedRequisition}`);
      }
    }

    const byId = new Map<string, typeof m.cvs>();
    for (const c of m.cvs)
      byId.set(c.candidateId, [...(byId.get(c.candidateId) ?? []), c]);
    for (const [id, group] of byId) {
      if (group.length > 1 && group.some((g) => g.duplicateGroup === null)) {
        fail(`${id} appears twice but is not marked as a duplicate`);
      }
      if (new Set(group.map((g) => g.name)).size > 1)
        fail(`${id} is used for different names`);
    }
    const groups = new Map<string, typeof m.cvs>();
    for (const c of m.cvs) {
      if (c.duplicateGroup) {
        const k = c.duplicateGroup.key;
        groups.set(k, [...(groups.get(k) ?? []), c]);
      }
    }
    for (const [key, [a, b, ...more]] of groups) {
      if (!b || more.length) fail(`group ${key} must hold exactly two files`);
      else if (a.candidateId !== b.candidateId)
        fail(`group ${key} mixes candidate ids`);
      else if (
        a.duplicateGroup!.kind === "exact" &&
        !(a.email === b.email && a.phone === b.phone)
      ) {
        fail(`group ${key}: exact duplicates must share email and phone`);
      } else if (
        a.duplicateGroup!.kind === "contact" &&
        !(a.phone === b.phone && a.email !== b.email)
      ) {
        fail(
          `group ${key}: contact duplicates must share phone and differ in email`,
        );
      } else if (
        a.duplicateGroup!.kind === "fuzzy" &&
        (a.phone === b.phone || a.email === b.email)
      ) {
        fail(
          `group ${key}: fuzzy duplicates must differ in both email and phone`,
        );
      }
    }
    const kinds = new Set(
      [...groups.values()].map((g) => g[0].duplicateGroup!.kind),
    );
    if (kinds.size !== 3) fail("expected one duplicate group of each kind");

    for (const b of BRIEF) {
      const c = m.cvs.find((x) => x.candidateId === b.id);
      if (
        !c ||
        c.name !== b.name ||
        c.currentRole !== b.role ||
        c.totalExperienceYears !== b.years ||
        c.noticeDays !== b.notice
      ) {
        fail(`${b.id} does not match the brief`);
      }
    }
  });

export type Manifest = z.infer<typeof manifestSchema>;

export const LABEL_NOTE =
  "expectedFit and intendedRequisition are evaluation labels for this repository. The app must never read them.";

export function buildManifest(
  jds: Jd[],
  cvs: { candidate: Candidate; pages: number | null }[],
  edge: EdgeFile[],
): Manifest {
  return manifestSchema.parse({
    asOf: AS_OF,
    note: LABEL_NOTE,
    jds: jds.map((j) => ({
      file: `jds/${j.file}`,
      format: j.format,
      key: j.key,
      client: j.client,
      title: j.title,
      mustHaveSkills: j.scorecard.mustHave,
      niceToHaveSkills: j.scorecard.niceToHave,
      experienceMinYears: j.scorecard.experienceMinYears,
      experienceMaxYears: j.scorecard.experienceMaxYears,
      locations: j.scorecard.locations,
      noticeMaxDays: j.scorecard.noticeMaxDays,
      ctcBudgetLpa: j.scorecard.ctcBudgetLpa,
      ambiguity: j.ambiguity,
    })),
    cvs: cvs.map(({ candidate: c, pages }) => ({
      file: `cvs/${c.file}`,
      format: c.file.endsWith(".docx") ? "docx" : "pdf",
      layout: c.layout,
      isScan: Boolean(c.scan),
      pages,
      candidateId: c.id,
      duplicateGroup: c.duplicate
        ? { key: c.duplicate.group, kind: c.duplicate.kind }
        : null,
      pool: c.pool,
      name: c.name,
      email: c.email,
      phone: c.phone,
      currentRole: c.currentRole,
      totalExperienceYears: totalExperienceYears(c.roles),
      statedExperience: c.statedExperience ?? null,
      skills: c.canonicalSkills,
      noticeText: c.noticeText ?? null,
      noticeDays: c.noticeDays,
      ctcText: c.ctcText ?? null,
      currentCtcLpa: c.currentCtcLpa,
      expectedCtcLpa: c.expectedCtcLpa,
      location: c.city,
      personalFieldsPresent: [
        ...PERSONAL_FIELDS.filter((f) => c.personal?.[f]),
        ...(c.photo ? ["photo"] : []),
      ],
      intendedRequisition: c.requisition,
      expectedFit: c.fit,
      adversarial: c.adversarial ?? null,
    })),
    edge: edge.map(({ file, format, description, expectedOutcome }) => ({
      file: `edge/${file}`,
      format,
      description,
      expectedOutcome,
    })),
  });
}
