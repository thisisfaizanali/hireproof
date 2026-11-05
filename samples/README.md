# Sample corpus

Realistic input files for building and demoing Hireproof: job descriptions to extract scorecards from, CVs to parse and score, and a few broken files for upload error states. `manifest.json` holds the ground truth for every file, so parser and ranking quality can be measured instead of eyeballed.

**Everything here is fictional.** Every person, employer, university project, email address and phone number was invented for this repository. Emails use `example.com`, `example.in` or `example.org`. Phone numbers are in the fake block `+91 90000 1xxxx`. Cities, universities and well-known degree names are real because they are not personal data. Any match with a real person or company is a coincidence.

## What is here

| Folder      | Files | Contents                                                                    |
| ----------- | ----- | --------------------------------------------------------------------------- |
| `jds/`      | 4     | 2 DOCX, 1 PDF, 1 pasted email as plain text                                 |
| `cvs/`      | 45    | 30 PDF (3 are image-only scans) and 15 DOCX                                 |
| `edge/`     | 6     | Files that must be rejected or flagged                                      |
| `manifest.json` |   | Ground truth for all of the above, validated by a Zod schema on generation |

### Job descriptions

| File                                      | Client           | Role                       | Notes                                                                                 |
| ----------------------------------------- | ---------------- | -------------------------- | ------------------------------------------------------------------------------------- |
| `Kestrel_Senior_Java_Developer_JD.docx`   | Kestrel Infotech | Senior Java Developer      | 5 to 8 years, Spring Boot, Noida, notice up to 60 days, 18 to 26 LPA                  |
| `Sahyadri_Finserv_KYC_Analyst_JD.pdf`     | Sahyadri Finserv | KYC Analyst                | 2 to 4 years, KYC, AML checks, Excel, Pune or Noida, notice up to 30 days, 5 to 8 LPA |
| `FW_ urgent requirement store ops manager.txt` | Marigold Retail | Store Operations Manager | A pasted email. Requirements are buried in prose, CTC is "as per market" (no number)  |
| `Kestrel_Java_Developer_JD_short.docx`    | Kestrel Infotech | Java Developer             | Sparse on purpose: no notice period, no CTC, no nice-to-haves                         |

### CVs by requisition

| Pool                           | Files | Spread                                                                                  |
| ------------------------------ | ----- | --------------------------------------------------------------------------------------- |
| Java (Kestrel)                 | 22    | strong, partial and poor fits, including the two Kestrel JDs                            |
| KYC (Sahyadri)                 | 12    | includes a retail banking operations officer and a customer service executive           |
| Retail (Marigold)              | 8     | store managers, an area manager, a hotel management fresher, an e-commerce operations manager |
| Fits nothing                   | 3     | graphic designer, civil engineer, mechanical design engineer                            |

The three candidates from the brief are in the manifest exactly as specified:

| Candidate ID | Name          | Current role          | Experience | Notice  |
| ------------ | ------------- | --------------------- | ---------- | ------- |
| CND-91022    | Ritika Bansal | Senior Java Developer | 6.5 years  | 60 days |
| CND-91047    | Arjun Rawat   | KYC Analyst           | 3.0 years  | 30 days |
| CND-91088    | Pooja Nair    | Java Developer        | 4.0 years  | 90 days |

Candidate IDs live only in the manifest. They are never printed on a CV.

### Edge files

| File                                      | What it is                                                | Expected outcome                                      |
| ----------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------- |
| `Vandana_Rawal_Resume.pdf`                | A valid PDF cut off at 55% of its bytes                   | rejected: file is corrupt or unreadable               |
| `Rajiv_Menon_CV.docx`                     | A valid DOCX with no text                                 | flagged: no text could be extracted                   |
| `Tarun_Bedi_Resume_protected.pdf`         | A CV protected with the open password `hireproof-sample`  | rejected: password protected                          |
| `Cover_Letter_Sneha_Iyer.pdf`             | A readable cover letter, no experience or skills          | flagged: readable text but no CV content              |
| `Resume_Gaurav_Sethi.odt`                 | A short CV in OpenDocument format                         | rejected: unsupported file type                       |
| `Kiran_Bhat_Resume_with_certificates.pdf` | A valid PDF of about 8.4 MiB (text page plus image page)  | for the upload size limit path                        |

## Variety checklist

- **Layouts (7):** classic one-column, sidebar with a skills column, modern minimal, dense multi-page senior (3 pages), one-page fresher with projects first, paragraph style DOCX, and the table-heavy Indian DOCX (personal details, skills, employment and education tables).
- **Experience:** stated in text ("6.5 years"), only derivable from dates, an overlap of two months, a ten month career break.
- **Date formats:** `Jan 2019 – Present`, `January 2019 – December 2022`, `03/2019 to 11/2022`, `Mar'19 - till date`.
- **Skill spellings:** Spring Boot, SpringBoot, Spring-Boot, J2EE, Core Java, MS Excel, Advanced Excel (VLOOKUP, Pivot).
- **Notice period:** `60 days`, `2 months`, `1 month`, `Immediate joiner`, `Serving notice, LWD 30 Nov 2026`, `Notice: negotiable`, and missing on several CVs.
- **CTC:** `12 LPA`, `₹14,50,000 p.a.`, `Current CTC 18L, Expected 24L`, `CTC: 9.6 lakhs`, and missing on many CVs.
- **Personal details the scorer must never use:** 13 CVs carry date of birth, age, gender, marital status, father's name, nationality or languages. 9 carry a photo placeholder (a flat silhouette, never a face). The manifest's `personalFieldsPresent` lists exactly which ones each CV has.
- **Contact details:** on every CV except one.
- **Scans (3):** clean, tilted on grey paper, and rough. Each is a PDF with an image only and no text layer.
- **Duplicates (3 groups):** exact (same email and phone, an updated DOCX), contact (same phone, different email), fuzzy (different email and phone, same name, employers and text).
- **Adversarial:** one CV hides "Ignore all previous instructions..." in 1px white text (present in the text layer, invisible on the page), and one CV stuffs 40 technologies into a skills block with almost no supporting experience.
- **Evidence beyond keywords:** a Spring Boot expert whose CV never uses the word "microservices" but describes independently deployed services.

## Reading the manifest

- `totalExperienceYears` is computed from the dated roles, counting each calendar month once, as of **November 2026** (`asOf`).
- `noticeDays` is `0` for an immediate joiner and `null` when the CV is missing it or ambiguous (including "Serving notice, LWD 30 Nov 2026", which depends on today's date). `noticeText` and `ctcText` hold the wording exactly as it appears on the CV.
- `pages` is `null` for DOCX files because the page count depends on the word processor.
- `expectedFit` and `intendedRequisition` are our own evaluation labels. The app must never read them or show them to the scorer.
- A "strong" fit is judged on skills and experience. A strong candidate can still have a notice period over the limit.

## Regenerating

```bash
npm run generate -w @hireproof/corpus
```

This wipes `jds/`, `cvs/`, `edge/` and `manifest.json`, regenerates everything, and runs the verification checks. The checks fail the command if the manifest does not validate, a file is missing from or extra to the manifest, a PDF or DOCX yields no text, a scan has a text layer, the hidden injection text is missing or visible, or the folder is over 25 MB.

To run only the checks:

```bash
npm run verify -w @hireproof/corpus
```

Output is reproducible: seeded randomness for the scan noise and the encrypted file, fixed PDF and DOCX dates, no clock reads. The PDFs are rendered with Chromium, so byte-identical output assumes the same Playwright version and the same installed fonts. Regenerating on another machine can change the PDF bytes (font substitution) without changing the content.

The generator and its dependencies (Playwright, sharp, docx, pdf-lib fork) live in `tools/corpus` and are not used by the apps.
