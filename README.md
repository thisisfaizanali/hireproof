# Hireproof

Hireproof is a resume screening tool for staffing firms. Recruiters create a job requisition, the AI extracts a scorecard from the job description, and recruiters bulk-upload CVs. Each CV is scored against the scorecard with evidence quoted from the CV. Recruiters then submit candidates to a client portal, and a pipeline tracks each requisition.

This repository holds the foundation (sign-in, role-based shells, API, shared schemas, local database) and requisitions with scorecard extraction from job descriptions.

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

Scorecard extraction uses an OpenAI-compatible chat API. All three variables are optional; set them in `.env` only, never in code or tests.

| Variable       | Meaning                                                                   |
| -------------- | ------------------------------------------------------------------------- |
| `LLM_BASE_URL` | API base URL. Defaults to Groq: `https://api.groq.com/openai/v1`          |
| `LLM_API_KEY`  | The provider key                                                          |
| `LLM_MODEL`    | Model id. List the ones your key can use with `GET {LLM_BASE_URL}/models` |

Without a key (or model) the app skips the AI and fills the scorecard with basic pattern matching, and says so on the requisition. Every AI answer is checked in code: each quote must exist in the job description, numbers must be plausible, and nothing is final until a recruiter confirms it. Each attempt is recorded in `AiRun` (model, outcome, latency, token counts; never the job description text).

Useful scripts, run from the repository root:

| Script                                         | What it does                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `npm run eval:jd -w @hireproof/api`            | Compares extraction on `samples/jds` with the ground truth in `samples/manifest.json`      |
| `npm run capture:scorecards -w @hireproof/api` | Runs the real model on the sample JDs and saves `apps/api/prisma/fixtures/scorecards.json` |

The seed creates four requisitions from the sample JDs, using the saved fixture when it exists and pattern matching otherwise.

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
