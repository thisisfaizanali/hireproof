# Hireproof

Hireproof is a resume screening tool for staffing firms. Recruiters create a job requisition, the AI extracts a scorecard from the job description, and recruiters bulk-upload CVs. Each CV is scored against the scorecard with evidence quoted from the CV. Recruiters then submit candidates to a client portal, and a pipeline tracks each requisition.

This repository holds the foundation (sign-in, role-based shells, API, shared schemas, local database), requisitions with scorecard extraction from job descriptions, and bulk CV upload with parsing, OCR for scans and duplicate detection.

## Prerequisites

- Node 24 (see `.nvmrc`) and npm
- Docker, for the local Postgres database

## Local setup

```bash
git clone https://github.com/thisisfaizanali/hireproof.git
cd hireproof
cp .env.example .env
```

`.env.example` lists the variable names only. Fill `.env` with these values, which are for local development only and must never be used anywhere else:

```bash
PORT=4000
DATABASE_URL=postgresql://hireproof:hireproof_local_only@localhost:5432/hireproof
API_INTERNAL_URL=http://localhost:4000

POSTGRES_USER=hireproof
POSTGRES_PASSWORD=hireproof_local_only
POSTGRES_DB=hireproof
POSTGRES_PORT=5432

SEED_DEMO_PASSWORD=demo-pass-local-1
NEXT_PUBLIC_DEMO_LOGINS=true
NEXT_PUBLIC_DEMO_PASSWORD=demo-pass-local-1
```

Then start the database, install, migrate, seed and run:

```bash
docker compose up -d db
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

If port 5432 is already in use on your machine, set `POSTGRES_PORT` in `.env` and use the same port in `DATABASE_URL`.

The web app runs on http://localhost:3000 and the API on http://localhost:4000. The browser only talks to the web origin, which proxies `/api` to the API, so the session cookie is first-party.

## AI configuration

Scorecard extraction and CV parsing use an OpenAI-compatible chat API. All the variables are optional; set them in `.env` only, never in code or tests.

| Variable          | Meaning                                                                   |
| ----------------- | ------------------------------------------------------------------------- |
| `LLM_BASE_URL`    | API base URL. Defaults to Groq: `https://api.groq.com/openai/v1`          |
| `LLM_API_KEY`     | The provider key                                                          |
| `LLM_MODEL`       | Model id. List the ones your key can use with `GET {LLM_BASE_URL}/models` |
| `LLM_PARSE_MODEL` | Model for reading CVs. Falls back to `LLM_MODEL`                          |

Recommended model: `openai/gpt-oss-120b` on Groq. It accepts `json_schema` structured output and quotes the job description faithfully. The free tier allows about 8,000 tokens a minute, which is roughly three extractions a minute; a busier desk falls back to pattern matching and offers "Try AI again".

Without a key (or model) the app skips the AI and fills the scorecard with basic pattern matching, and says so on the requisition. Every AI answer is checked in code: each quote must exist in the job description, numbers must be plausible, and nothing is final until a recruiter confirms it. Each attempt is recorded in `AiRun` (model, outcome, latency, token counts; never the job description text).

Useful scripts, run from the repository root:

| Script                                         | What it does                                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `npm run eval:jd -w @hireproof/api`            | Compares extraction on `samples/jds` with the ground truth in `samples/manifest.json`         |
| `npm run capture:scorecards -w @hireproof/api` | Runs the real model on the sample JDs and saves `apps/api/prisma/fixtures/scorecards.json`    |
| `npm run eval:cv -w @hireproof/api`            | Parses `samples/cvs` and `samples/edge` and compares with the ground truth; prints tables     |
| `npm run capture:cvs -w @hireproof/api`        | Runs the real CV pipeline (text, OCR, AI) and saves `apps/api/prisma/fixtures/cv-parses.json` |

The seed creates four requisitions from the sample JDs, using the saved fixture when it exists and pattern matching otherwise. It then loads the sample CVs into those requisitions from `cv-parses.json`, with no model call and no OCR. Without that fixture it parses the text CVs with rules only and skips the scans.

## CV upload and parsing

A recruiter opens a requisition, chooses its Candidates tab and drops PDF or DOCX files in. The browser checks type and size first, then sends the files ten at a time. Everything the server accepts is queued and shows live status: Queued, Reading, Scanning (OCR), Parsing, then Done, Needs review, Failed or Duplicate file. The page can be left; the batch keeps going and shows again on return.

| Limit | Value                                |
| ----- | ------------------------------------ |
| Types | PDF and DOCX, checked by magic bytes |
| Size  | 10 MB a file                         |
| Files | 10 a request, 500 a batch            |

What happens to a CV (`apps/api/src/cv`):

1. **Text.** The text layer of a PDF, or the paragraphs of a DOCX. A damaged, password protected or empty file fails with a plain reason.
2. **OCR.** A PDF with under 100 characters of text per page is treated as a scan. Its first 3 pages are drawn to images (`unpdf` with `@napi-rs/canvas`, which ship prebuilt binaries for Windows and Linux) and read by `tesseract.js`. The English language data comes from the `@tesseract.js-data/eng` package, so nothing is fetched at run time. A page that reads below 80 confidence is read again after flattening the lighting and removing scanner speckle, and the better read is kept. A mean confidence under 70 adds the review reason "Scanned CV, text may be misread".
3. **Rules.** Email, phone (last ten digits), skills from the shared dictionary, notice period, CTC and experience. Experience is computed from the date ranges in the CV, counting each calendar month once, with "Present" ending at the current month. Education sections are skipped. Notice and CTC keep the CV's own wording next to the parsed number.
4. **AI.** A small JSON call for name, current role, location and total experience. The CV goes in as untrusted data between markers, without email, phone or personal-detail lines. Every value must appear in the CV text or it is dropped. Rules win for email, phone, skills, notice and CTC. If the AI and the computed experience differ by more than a year, the computed one is kept and the CV is flagged.
5. **Without the AI** (no key, rate limited past the retry budget, invalid output twice) the CV is parsed from rules, the name comes from the top of the page, and the review reason is "Parsed without AI, check name and role". A CV never fails because of the AI.
6. **Redaction.** `redactedText` drops the name, email, phone and any line or field for date of birth, age, gender, marital status, parents' names, religion, caste, nationality, passport, languages known and photo captions. Only `redactedText` is ever meant to be sent for scoring. The raw text and the original file stay so a recruiter can read the CV.
7. **Duplicates**, in order. The same file bytes attach to the existing candidate and are marked as a duplicate file. The same email or the same phone attaches to the existing candidate and records a link with the reason. The same name with a very similar CV (three-word shingles, Jaccard 0.5 or more) creates a pending link for a recruiter to resolve with "Same person" or "Different people". Fuzzy matches are never merged automatically.

### Queue and rate limits

Jobs run on `pg-boss` inside the API process, so there is one service to deploy; move it to a worker process when volume needs it. Two CVs are read at a time. Every model call goes through one throttle: after each response it reads `x-ratelimit-remaining-tokens` and the reset header, waits for the reset when the budget is too low for the next call, and on a 429 waits for `retry-after` and retries up to three times before falling back to rules. Jobs survive a restart, and CVs left mid-run are queued again when the API starts.

The CV files are stored in Postgres for now. Move them to object storage at real volume; deleting a candidate stays a single transaction while the bytes are here.

## Demo accounts

The seed creates three fictional client companies and five users. Every user signs in with the value of `SEED_DEMO_PASSWORD`.

| Email                                 | Role           | Client           |
| ------------------------------------- | -------------- | ---------------- |
| `ananya.sharma@hireproof.test`        | Recruiter      |                  |
| `rohan.mehta@hireproof.test`          | Recruiter      |                  |
| `vikram.rao@hireproof.test`           | Delivery head  |                  |
| `priya.nair@kestrelinfotech.test`     | Hiring manager | Kestrel Infotech |
| `arjun.kulkarni@sahyadrifinserv.test` | Hiring manager | Sahyadri Finserv |

Recruiters and the delivery head land on `/requisitions`. Hiring managers land on `/portal` and only ever see their own company.

With `NEXT_PUBLIC_DEMO_LOGINS=true` the login page also lists these accounts as one-click buttons, using `NEXT_PUBLIC_DEMO_PASSWORD`. That password is readable in the browser, so this is for the demo deployment only. Leave both variables empty anywhere real users sign in.

## Layout

- `apps/web`: Next.js (App Router, TypeScript, Tailwind, shadcn/ui)
- `apps/api`: Express, TypeScript and Prisma (schema and migrations in `apps/api/prisma`)
- `packages/shared`: Zod schemas shared by both apps
- `docs/design.md`: design system decisions

## Scripts

Run from the repository root.

| Script                 | What it does                                                    |
| ---------------------- | --------------------------------------------------------------- |
| `npm run dev`          | Runs the API and web app with reload                            |
| `npm run build`        | Builds shared, API and web                                      |
| `npm run lint`         | ESLint across all workspaces                                    |
| `npm run typecheck`    | TypeScript checks across all workspaces                         |
| `npm test`             | API tests (Vitest and Supertest)                                |
| `npm run format`       | Formats the repository with Prettier                            |
| `npm run format:check` | Fails if any file is not formatted                              |
| `npm run db:migrate`   | Applies migrations to the local database (creates new ones)     |
| `npm run db:seed`      | Creates or updates the fictional clients and demo users         |
| `npm run db:reset`     | Drops the local database, re-applies migrations and seeds again |

## Tests

`npm test` needs the compose database running. It uses a separate database named like the one in `DATABASE_URL` with `_test` added (for example `hireproof_test`), creates it if it is missing and applies the migrations, so your development data is never touched. Set `TEST_DATABASE_URL` to use a different database.
