# Hireproof

Hireproof is a resume screening tool for staffing firms. Recruiters create a job requisition, the AI extracts a scorecard from the job description, and recruiters bulk-upload CVs. Each CV is scored against the scorecard with evidence quoted from the CV. Recruiters then submit candidates to a client portal, and a pipeline tracks each requisition.

This repository currently holds the project scaffold only: a web app, an API, a shared schema package and a local database.

## Prerequisites

- Node 24 (see `.nvmrc`) and npm
- Docker, for the local Postgres database

## Local setup

```bash
git clone https://github.com/thisisfaizanali/hireproof.git
cd hireproof
cp .env.example .env
docker compose up -d db
npm install
npm run dev
```

The web app runs on http://localhost:3000 and the API on http://localhost:4000. The home page shows the API health result, fetched through the web app's `/api` proxy.

## Layout

- `apps/web`: Next.js (App Router, TypeScript, Tailwind)
- `apps/api`: Express and TypeScript
- `packages/shared`: Zod schemas shared by both apps

## Scripts

Run from the repository root.

| Script                 | What it does                            |
| ---------------------- | --------------------------------------- |
| `npm run dev`          | Runs the API and web app with reload    |
| `npm run build`        | Builds shared, API and web              |
| `npm run lint`         | ESLint across all workspaces            |
| `npm run typecheck`    | TypeScript checks across all workspaces |
| `npm test`             | API tests (Vitest and Supertest)        |
| `npm run format`       | Formats the repository with Prettier    |
| `npm run format:check` | Fails if any file is not formatted      |
