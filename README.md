# Hireproof

Hireproof is a resume screening tool for staffing firms. Recruiters create a job requisition, the AI extracts a scorecard from the job description, and recruiters bulk-upload CVs. Each CV is scored against the scorecard with evidence quoted from the CV. Recruiters then submit candidates to a client portal, and a pipeline tracks each requisition.

This repository currently holds the foundation: a web app with sign-in and role-based shells, an API with session authentication, a shared schema package and a local database.

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

`npm test` needs the compose database running and applied migrations (`npm run db:migrate`). The tests use the database in `DATABASE_URL` and truncate its tables, so run `npm run db:seed` again afterwards, or point `DATABASE_URL` at a separate database while testing.
