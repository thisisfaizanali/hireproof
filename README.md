# Hireproof

Hireproof is a resume screening tool for a staffing firm. A recruiter turns a job description into a confirmed scorecard, drops in a batch of CVs (PDF, DOCX, scans), and gets a ranked list where every point is backed by a sentence quoted from the CV and checked in code. Client hiring managers see the submitted candidates on their phones, with the evidence and without contact details. A delivery head sees whether the AI and the recruiters agree.

**Live app:** {{WEB_URL}}

## Sign in

Every account uses the same password: `{{DEMO_PASSWORD}}`. The login page also has one-click buttons.

| Email                                 | Role                             | Try this                                                                                                                     |
| ------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `ananya.sharma@hireproof.test`        | Recruiter                        | Open Senior Java Developer, then Candidates. Read "Why this score", open a CV, upload a few CVs from `samples/cvs`           |
| `rohan.mehta@hireproof.test`          | Recruiter                        | The same desk as Ananya. Use this account if the first one is locked                                                         |
| `vikram.rao@hireproof.test`           | Delivery head                    | Insights, Audit log and Data. Review the weekly sample, open the delete dialog (cancel it unless you want to erase someone)  |
| `priya.nair@kestrelinfotech.test`     | Hiring manager, Kestrel Infotech | Open the portal on a phone or at 375px. Read a candidate, shortlist, propose interview times. Only Kestrel's data is visible |
| `arjun.kulkarni@sahyadrifinserv.test` | Hiring manager, Sahyadri Finserv | The same portal with a different client's candidates                                                                         |

**The first load can take up to about a minute.** The free API host sleeps when idle. The login page says "Starting the server" while it wakes, and everything is quick after that.

**If a demo login is locked, wait 15 minutes or use the other recruiter, `rohan.mehta@hireproof.test`.** Five failed sign-ins on one account lock it for 15 minutes. The password is the one above, so this only happens after a typing mistake or a deliberate attempt.

## A two minute tour

1. **Ranked list and evidence.** Sign in as Ananya. Open the Senior Java Developer requisition and its Candidates tab. The list is ranked, with notice, CTC and location shown as flags that never change the score. Open "Why this score" on the top row: each criterion has a verdict, its points and the quotes found in the CV.
2. **The CV viewer.** Open a candidate. Switch between the original and the text. The verified quotes are marked in the text. "Mark screened" stays disabled until the CV has been opened, and the server enforces the same rule.
3. **The scorecard.** Back on the requisition, open the Scorecard tab. Each requirement shows its source quote in the job description, and items the AI was unsure about wait for a "Looks right" before the scorecard can be confirmed.
4. **Upload.** On Candidates, tick the consent statement, pick a source, and add a few files from `samples/cvs` (the three `scan` files go through OCR). Watch each file move from Queued to Done. Files that are already in the demo are recognised as duplicates, and the duplicate review says why.
5. **The client's side.** Sign out and sign in as Priya Nair, ideally at 375px wide. She sees submitted candidates, the recruiter's note, the evidence and a band label, and no email, phone or score out of 100. Propose a time, then sign back in as Ananya and confirm it. The message to the candidate is recorded, not sent.
6. **The delivery head.** Sign in as Vikram Rao. Insights shows where the AI and the recruiters agreed that week, the ten decisions to review, and the health of the AI. The Audit log reads as sentences, and the Data page lists candidates past their retention date.

## Documents

- Technical design: [PDF](docs/Hireproof-TDD.pdf) or [Markdown](docs/TDD.md). Architecture, assumptions, measured accuracy, security, limits.
- [Deployment guide](docs/deployment.md): Neon, Render, Vercel and the smoke test, step by step.
- [Design system](docs/design.md): tokens, type, and the rules behind each screen.
- [Screenshots](docs/screenshots): desktop and 375px captures of every screen, by feature.

## Run it locally

You need Node 26 (see `.nvmrc`), npm and Docker.

```bash
git clone https://github.com/thisisfaizanali/hireproof.git
cd hireproof
cp .env.example .env
```

`.env.example` lists the variable names. Fill `.env` with these values. They are for local development only and must not be used anywhere else:

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

Then:

```bash
docker compose up -d db
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

The web app is on http://localhost:3000 and the API on http://localhost:4000. The browser only talks to the web origin, which forwards `/api` to the API. If port 5432 is taken, set `POSTGRES_PORT` in `.env` and use the same port in `DATABASE_URL`. The local password is `demo-pass-local-1`, the value of `SEED_DEMO_PASSWORD`.

**Everything in Docker, without installing Node packages for the apps:**

```bash
docker compose --profile app up --build
```

This runs Postgres, the API (in a 512 MB container, the size of the hosted free instance) and a production build of the web app. The database starts empty, so load the demo data from your machine with `npm run db:seed` (see [deployment.md](docs/deployment.md#running-everything-locally)). Use Chrome, Edge or Firefox, because the session cookie is marked secure.

The seed needs no AI key and no OCR: it loads captured scorecards, CV parses and scores from `apps/api/prisma/fixtures`. To use the AI for new uploads, set `LLM_API_KEY` and `LLM_MODEL` (and optionally `LLM_PARSE_MODEL`, `LLM_BASE_URL`) in `.env`. The defaults point at Groq. Recommended models are `openai/gpt-oss-120b` for `LLM_MODEL` and `openai/gpt-oss-20b` for `LLM_PARSE_MODEL`. Without a key the app falls back to rules and says so on every screen it affects.

### Scripts

| Script               | What it does                                                      |
| -------------------- | ----------------------------------------------------------------- |
| `npm run dev`        | Runs the API and the web app with reload                          |
| `npm run build`      | Builds shared, API and web                                        |
| `npm run lint`       | ESLint across the repository                                      |
| `npm run typecheck`  | TypeScript checks across all workspaces                           |
| `npm test`           | API tests, Vitest and Supertest against a real Postgres           |
| `npm run format`     | Formats the repository with Prettier (`format:check` only checks) |
| `npm run db:migrate` | Applies migrations to the local database                          |
| `npm run db:seed`    | Creates or updates the fictional clients, users and demo data     |
| `npm run db:reset`   | Drops the local database, re-applies migrations and seeds again   |
| `npm run smoke`      | Checks a running deployment: `npm run smoke -- --web <url>`       |
| `npm run docs:pdf`   | Renders `docs/TDD.md` to `docs/Hireproof-TDD.pdf`                 |

`npm test` needs the compose database running. It uses a separate database named like the one in `DATABASE_URL` with `_test` added, creates it if missing, and applies the migrations, so development data is never touched. Set `TEST_DATABASE_URL` to use another one.

### Evaluation scripts

These measure the AI and the rules against the ground truth in `samples/manifest.json`. The figures in the design document come from them. Run them from the repository root.

| Command                                        | What it measures                                                                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `npm run eval:jd -w @hireproof/api`            | Scorecard extraction from the four sample job descriptions                                                                 |
| `npm run eval:cv -w @hireproof/api`            | CV parsing, duplicates and edge files over the 45 sample CVs. Rules only when no key is set                                |
| `npm run eval:score -w @hireproof/api`         | Ranking, evidence checks and the adversarial CVs. Replays captured answers, so it costs no tokens. `--live` asks the model |
| `npm run capture:scorecards -w @hireproof/api` | Runs the real model on the job descriptions and saves the answers the seed uses                                            |
| `npm run capture:cvs -w @hireproof/api`        | Runs the real CV pipeline, including OCR, and saves the parses                                                             |
| `npm run capture:scores -w @hireproof/api`     | Runs real scoring and saves the answers. `--wait` rides out a daily token cap                                              |
| `npm run generate -w @hireproof/corpus`        | Regenerates the fictional sample CVs and job descriptions, then checks them                                                |

## Repository layout

- `apps/web`: Next.js (App Router, TypeScript, Tailwind, shadcn/ui)
- `apps/api`: Express, TypeScript and Prisma (schema and migrations in `apps/api/prisma`)
- `packages/shared`: Zod schemas shared by both apps, the score bands and the stage rules
- `tools/corpus`: generator for the fictional sample CVs and job descriptions
- `tools/docs`: renders the design document to PDF
- `samples`: the 45 CVs, 6 edge files and 4 job descriptions, with their ground truth
- `scripts/smoke.mjs`: the deployment smoke test
