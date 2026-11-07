# Hireproof

Hireproof is a resume screening tool for staffing firms. Recruiters create a job requisition, the AI extracts a scorecard from the job description, and recruiters bulk-upload CVs. Each CV is scored against the scorecard with evidence quoted from the CV. Recruiters then submit candidates to a client portal, and a pipeline tracks each requisition.

This repository holds the foundation (sign-in, role-based shells, API, shared schemas, local database), requisitions with scorecard extraction from job descriptions, bulk CV upload with parsing, OCR for scans and duplicate detection, evidence-backed scoring with a ranked candidate list and a CV viewer, and the client portal with the pipeline from submission to joining.

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

| Variable          | Meaning                                                                            |
| ----------------- | ---------------------------------------------------------------------------------- |
| `LLM_BASE_URL`    | API base URL. Defaults to Groq: `https://api.groq.com/openai/v1`                   |
| `LLM_API_KEY`     | The provider key                                                                   |
| `LLM_MODEL`       | Model id. List the ones your key can use with `GET {LLM_BASE_URL}/models`          |
| `LLM_PARSE_MODEL` | Model for reading CVs. Recommended `openai/gpt-oss-20b`. Falls back to `LLM_MODEL` |

Recommended models on Groq: `openai/gpt-oss-120b` for `LLM_MODEL` (scorecards and scoring) and `openai/gpt-oss-20b` for `LLM_PARSE_MODEL`. Each model has its own daily token budget (200,000 tokens a day for 120b on the free tier), so reading CVs with 20b leaves the 120b budget for scoring. On the 45 sample CVs the two read name, role and experience equally well. It accepts `json_schema` structured output and quotes the job description faithfully. The free tier allows about 8,000 tokens a minute, which is roughly three extractions a minute; a busier desk falls back to pattern matching and offers "Try AI again".

Without a key (or model) the app skips the AI and fills the scorecard with basic pattern matching, and says so on the requisition. Every AI answer is checked in code: each quote must exist in the job description, numbers must be plausible, and nothing is final until a recruiter confirms it. Each attempt is recorded in `AiRun` (model, outcome, latency, token counts; never the job description text).

Useful scripts, run from the repository root:

| Script                                         | What it does                                                                                                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run eval:jd -w @hireproof/api`            | Compares extraction on `samples/jds` with the ground truth in `samples/manifest.json`                                                               |
| `npm run capture:scorecards -w @hireproof/api` | Runs the real model on the sample JDs and saves `apps/api/prisma/fixtures/scorecards.json`                                                          |
| `npm run eval:cv -w @hireproof/api`            | Parses `samples/cvs` and `samples/edge` and compares with the ground truth; prints tables                                                           |
| `npm run capture:cvs -w @hireproof/api`        | Runs the real CV pipeline (text, OCR, AI) and saves `apps/api/prisma/fixtures/cv-parses.json`                                                       |
| `npm run capture:scores -w @hireproof/api`     | Runs real scoring over the sample CVs and saves `apps/api/prisma/fixtures/scores.json`. `--wait` rides out a daily token cap; finished CVs are kept |
| `npm run eval:score -w @hireproof/api`         | Compares rankings with the expected fit in the manifest. Replays the captured scores; `--live` asks the model again. Writes nothing                 |

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

## Scoring and evidence

A confirmed scorecard ranks the candidates of its requisition. For each criterion the AI returns a verdict (met, partial or not found) and at most two short quotes from the CV. Code does the rest (`apps/api/src/score`).

**Evidence first.** Every quote is looked up in the CV text that was sent to the model, ignoring case, spacing and punctuation. A met or partial verdict with no quote found becomes not found and is flagged "The AI cited text that is not in the CV". No points are ever given without a verified quote. The model only ever sees `redactedText`: no name, email or phone.

**The formula** lives in one function, `computeScore`, and is shown in the page:

| Part                                           | Points |
| ---------------------------------------------- | ------ |
| Must-haves, shared equally                     | 70     |
| Nice-to-haves, shared equally                  | 20     |
| Experience against the scorecard's min and max | 10     |

A met criterion earns its whole share and a partial one half. Experience is full inside the range, falls in a straight line to zero two years outside it, and is half when the CV does not state it. Points a group cannot use move on: with no nice-to-haves the must-haves hold 90, with no must-haves the nice-to-haves hold 90, and with neither, experience is the whole score. The total is out of 100, rounded.

**Bands.** Strong match is 75 or more with no must-have missing, so a partial must-have is allowed. `npm run db:reband -w @hireproof/api` applies the rule to stored scores from their stored criteria, with no model call. Possible match is 50 or more. Weak match is below 50.

**Constraints are flags, not points.** Notice over the limit, expected CTC over the budget, a location outside the list, and any of those not stated are shown beside the score and never change it. The ranked list shows them as short labels (Notice, CTC, Location, or "unknown" when the CV does not say) with the full sentence as a tooltip and an accessible label.

**Soft skills.** A must-have a CV cannot evidence (communication, team player, attitude, willingness to learn, flexibility with shifts) is flagged for review when the scorecard is extracted, with the note "Hard to check from a CV, consider making it a nice-to-have". The list is `isSoftSkill` in `packages/shared`. A degree requirement stays a must-have: the scoring prompt, and the rules scorer, take a line in the education section as its evidence.

**Unchanged scorecards.** Confirming stores a hash of the criteria (kind and label) and the ranges. Confirming the same content again keeps the version, marks no score stale and queues nothing.

**Defences.** The CV goes to the model as untrusted data between markers, with an instruction to ignore anything addressed to it. A skill that only sits in a skills list is partial at most. Both are checked against the sample corpus by `eval:score`.

**Without the AI** (no key, the daily budget spent, or invalid output twice) a rules score is used and labelled "Scored without AI": a dictionary skill in a role, project or summary line is met, one that only sits in a skills list is partial, and anything else is not found. The quote is the matched line, verified the same way. Scoring never fails because of the AI.

**Staleness.** Each score stores the scorecard version it used. Confirming a scorecard marks older scores stale and queues every application again; the list shows "Re-scoring" and never mixes versions in one ranking. Scoring runs on a second `pg-boss` queue (`cv-score`) behind the same throttle as parsing.

**Limits.** The CV part of a prompt is capped at 6,000 characters (about 1,700 tokens), and low-value sections (hobbies, references, languages) are dropped first. A score takes about 1,400 tokens and two seconds on gpt-oss-120b, so a requisition of 45 CVs costs about 60,000 tokens, a third of a day's free budget.

**Decisions.** "Mark screened" and "Not a fit" (with a reason) are audited with the AI band at the time. The server refuses "Mark screened" unless the same recruiter has a logged view of that candidate's newest CV, and the page disables the button with the same sentence. Every view of a CV, as the original or as text, is logged, including the delivery head's. The delivery head reads everything and changes nothing.

## Client portal and pipeline

A recruiter submits a screened candidate with a note of 20 to 600 characters on why this candidate. Only a screened candidate can be submitted, and a submission can be withdrawn until the client acts. Stages move through one pure function, `canMove(from, to, role)` in `packages/shared`, with a test over every role and pair; the move route answers 409 with a plain message for any other move.

**What a hiring manager sees.** Name, candidate code, current role, experience, notice, location and skills; the note from the recruiter; each must-have and nice-to-have with its verdict and the verified quotes; the constraint flags as sentences; and a client CV text. Contact details are left out of the response type, not hidden in the page: no email, phone, file, raw text, 0 to 100 total, score source or review reason ever leaves the API for a client, and quotes, notes and notice text also pass through a final email and phone mask. The client CV text is the extracted text through the same redaction code as the scoring text with a `keepName` option, so contact and personal fields go and the name stays. The portal says: "Contact details are shared by your Hireproof recruiter."

**Tenancy.** Every portal query carries the manager's client in the `where` clause, so another client's requisition or application is a 404, not a 403, and a draft requisition or an application that has not been submitted is never found. Portal routes refuse recruiters and the delivery head (403), and hiring managers get 403 on every internal route.

**Client actions** (own client, submitted applications only, none can be undone): shortlist; reject with a reason (skills gap, experience, notice period, compensation, location, already interviewed, other with a note), recorded as the client's decision in its own columns so the delivery head report can tell it from a recruiter's rejection; propose one to three interview times. A time is read in IST, must be in the future, on a weekday, and finish by 19:00 (start from 9:00). Proposing a time also shortlists the candidate.

**Recruiter side.** Pending proposals show under the candidate in the requisition list. Confirm books one time (stage Interview, the other times declined) and records a message to the candidate; "None of these work" declines all of them and records a message to the client. Messaging is mocked: an `OutboundMessage` row holds the subject and body with status MOCKED, and the page says the message was recorded, not sent. After the interview a recruiter moves a candidate to offered or not selected, then to joined or offer fell through. Each move is audited (`STAGE_CHANGED` with the stages), as are submission, withdrawal, the client views and answers, and the slots.

The seed leaves a believable week: Kestrel has five submissions (two awaiting the client, one shortlisted, one rejected for notice period, one with two proposed times waiting on the recruiter) and Sahyadri has three (one at interview with a confirmed time, one offered, one to review).

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

| Script                                | What it does                                                    |
| ------------------------------------- | --------------------------------------------------------------- |
| `npm run dev`                         | Runs the API and web app with reload                            |
| `npm run build`                       | Builds shared, API and web                                      |
| `npm run lint`                        | ESLint across all workspaces                                    |
| `npm run typecheck`                   | TypeScript checks across all workspaces                         |
| `npm test`                            | API tests (Vitest and Supertest)                                |
| `npm run format`                      | Formats the repository with Prettier                            |
| `npm run format:check`                | Fails if any file is not formatted                              |
| `npm run db:migrate`                  | Applies migrations to the local database (creates new ones)     |
| `npm run db:seed`                     | Creates or updates the fictional clients and demo users         |
| `npm run db:reset`                    | Drops the local database, re-applies migrations and seeds again |
| `npm run db:reband -w @hireproof/api` | Re-bands stored scores under the current band rule (no model)   |

## Tests

`npm test` needs the compose database running. It uses a separate database named like the one in `DATABASE_URL` with `_test` added (for example `hireproof_test`), creates it if it is missing and applies the migrations, so your development data is never touched. Set `TEST_DATABASE_URL` to use a different database.
