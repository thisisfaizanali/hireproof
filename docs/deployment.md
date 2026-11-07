# Deploying Hireproof

This is a checklist. Follow it top to bottom. Every step says exactly what to click or type. Nothing here needs you to understand the tools; if a step does not match what you see, stop and check Troubleshooting at the end.

## What you are building

Three free services, one for each part:

```mermaid
flowchart LR
  B[Browser] -->|HTTPS| V["Vercel<br/>web app (Next.js)<br/>region sin1"]
  V -->|"/api/* forwarded"| R["Render<br/>API in a Docker container<br/>Singapore"]
  R -->|"SSL, direct connection"| N[("Neon<br/>Postgres<br/>Singapore")]
  R -->|HTTPS| L["Groq<br/>AI model"]
```

- **Vercel** serves the pages. It also forwards every `/api/...` request to the API, so the browser only ever talks to one address and the sign-in cookie belongs to the Vercel address.
- **Render** runs the API in a Docker container built from `apps/api/Dockerfile`. The background queue (pg-boss) runs inside the same process. On start it applies any database migrations that have not been applied.
- **Neon** holds all the data, including the uploaded CV files.

Keep the three in the same region (Singapore, Vercel `sin1`) so a request does not cross the world three times.

You will need free accounts on Neon, Render and Vercel, and the GitHub repository connected to Render and Vercel. You will also need your Groq API key. This guide never asks you to paste a secret anywhere except into those sites' own settings pages.

## Before you start

1. Decide the **demo password**. It is shared by all five demo users, and the login page shows it to anyone who opens the site (the quick-login buttons). Do not reuse a real password. Write it down; the steps below call it `DEMO_PASSWORD`.
2. Have your Groq key ready. It is optional (without it the app scores with plain rules), but the demo is better with it.
3. Node 26 and npm on your machine (`node -v` should print `v26...`). Needed for steps 2 and 5 only.

## 1. Neon: create the database

1. Go to neon.com and sign in.
2. Create a project. Name: `hireproof`. Postgres version: the default (the newest offered). **Region: Asia Pacific (Singapore).**
3. Open the project's dashboard and press **Connect**.
4. Turn **off** the switch labelled **Connection pooling**. The host name must **not** contain `-pooler`.
5. Copy the connection string. It looks like `postgresql://USER:PASSWORD@ep-something.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`.
6. Check the end of it says `?sslmode=require`. If it does not, add `?sslmode=require` yourself. If it already has other settings (a `?`), add `&sslmode=require` instead.

This string is your `DATABASE_URL`. It contains a password. Keep it out of files, chat and screenshots.

**Why the direct (unpooled) one?** A pooled connection hands each query to whichever connection is free. Prisma Migrate takes a lock and expects to keep the same connection for the whole migration. The queue (pg-boss) does the same with its locks and waits for notifications. Both break or misbehave behind a pooler. Traffic here is a handful of reviewers, so the direct connection is nowhere near its limit.

## 2. Create the tables and the demo data

Do this from your machine, against Neon. The seed uses the sample CVs and saved AI results in the repository, so it needs no AI key and no OCR. It takes a minute or two over the internet.

The values are set for one command only so they do not stay in your shell.

**PowerShell**

```powershell
cd path\to\hireproof
$env:DATABASE_URL = "PASTE_THE_NEON_STRING_HERE"
$env:SEED_DEMO_PASSWORD = "DEMO_PASSWORD"
try {
  Push-Location apps/api
  npx prisma migrate deploy
  Pop-Location
  npm run db:seed
} finally {
  Remove-Item Env:DATABASE_URL, Env:SEED_DEMO_PASSWORD
}
```

**bash**

```bash
cd path/to/hireproof
(
  export DATABASE_URL='PASTE_THE_NEON_STRING_HERE'
  export SEED_DEMO_PASSWORD='DEMO_PASSWORD'
  (cd apps/api && npx prisma migrate deploy)
  npm run db:seed
)
```

Success looks like "All migrations have been successfully applied" and then a table of five demo users. Run `npm install` first if you have not already.

The API applies migrations again every time it starts. That is safe: it only applies the ones that are missing. Doing it here as well means you see a failure on your own screen instead of in a hosting log.

## 3. Render: run the API

1. Go to render.com and sign in with GitHub.
2. Press **New**, then **Blueprint**.
3. Pick the `hireproof` repository (connect it first if Render asks). Branch: `main`.
4. Render reads `render.yaml` and shows one service, `hireproof-api` (Docker, Free, Singapore). It asks for two secret values:
   - `DATABASE_URL`: paste the Neon string from step 1.
   - `LLM_API_KEY`: paste your Groq key, or leave it empty for no AI.
5. Press **Apply**. The first build takes several minutes (it installs everything and builds the image).
6. Wait until the service shows **Live**. Render marks it live only after `/api/health` answers 200 with the database reachable.
7. Copy the service address at the top of the page. It looks like `https://hireproof-api-xxxx.onrender.com`. This is your API address. Open `API_ADDRESS/api/health` in a browser; you should see `{"status":"ok","db":"up",...}`.

The values `render.yaml` sets for you, so you can see what they are:

| Variable          | Value                            | Why                                                                                            |
| ----------------- | -------------------------------- | ---------------------------------------------------------------------------------------------- |
| `NODE_ENV`        | `production`                     | Turns on secure cookies and hides error details                                                |
| `TRUST_PROXY`     | `4`                              | See "Client addresses and TRUST_PROXY"                                                         |
| `CV_CONCURRENCY`  | `1`                              | One CV is read at a time so the 512 MB instance stays inside its memory (measured, see Memory) |
| `LLM_BASE_URL`    | `https://api.groq.com/openai/v1` | The AI provider                                                                                |
| `LLM_MODEL`       | `openai/gpt-oss-120b`            | Scorecards and scoring                                                                         |
| `LLM_PARSE_MODEL` | `openai/gpt-oss-20b`             | Reading CVs, so the larger model's daily budget is kept for scoring                            |

## 4. Vercel: serve the web app

1. Go to vercel.com and sign in with GitHub.
2. Press **Add New**, then **Project**, and import the `hireproof` repository.
3. Set **Root Directory** to `apps/web`. Leave **Include source files outside of the Root Directory** switched on (it is on by default). The framework should show as Next.js.
4. Leave the install and build commands alone. They come from `apps/web/vercel.json` and install and build the shared package first.
5. Open **Environment Variables** and add exactly one:
   - Name `API_INTERNAL_URL`, value your Render address from step 3 (no slash at the end, for example `https://hireproof-api-xxxx.onrender.com`).
6. Add the two demo login variables so the quick-login buttons appear on the login page:
   - `NEXT_PUBLIC_DEMO_LOGINS` = `true`
   - `NEXT_PUBLIC_DEMO_PASSWORD` = your `DEMO_PASSWORD`

   Only `API_INTERNAL_URL` is needed for the app to work. These two are for the demo and are visible to anyone who opens the page, which is why the password must be a throwaway one.

7. Press **Deploy**. Under Project Settings, then Functions, the region should be Singapore (`sin1`); `vercel.json` asks for it.
8. When it finishes, copy the address, for example `https://hireproof-xxxx.vercel.app`. This is the address you give reviewers.

`API_INTERNAL_URL` is read when the site is built, because the `/api` forwarding is fixed at build time. If you change it later, redeploy.

## 5. Run the smoke test

From your machine. It signs in as the demo users, checks each role's main screens, checks the security headers and checks what address the audit log recorded for you. It waits up to two minutes for a sleeping API to wake.

**PowerShell**

```powershell
$env:SMOKE_PASSWORD = "DEMO_PASSWORD"
try { npm run smoke -- --web https://YOUR-APP.vercel.app } finally { Remove-Item Env:SMOKE_PASSWORD }
```

**bash**

```bash
SMOKE_PASSWORD='DEMO_PASSWORD' npm run smoke -- --web https://YOUR-APP.vercel.app
```

Every line should say `pass` and the last line should be `All checks passed`. Any failure is listed at the end and the command exits with an error.

**Do one manual comparison.** Near the end, the test prints a line like `latest sign-in address is not a private or proxy one (203.0.x.x)`. That is the address the API recorded for the sign-in the test just made, with the last two numbers hidden. Search "what is my IP" in a browser. The first two numbers must match. If they do not, `TRUST_PROXY` is wrong; see Troubleshooting.

Then open the Vercel address in a browser and sign in as each of the three roles once.

## 6. What reviewers should know

Put these in the README you submit.

**Demo logins.** The login page has one-click buttons. The accounts, all with the same password, are:

| Email                                 | Role           |
| ------------------------------------- | -------------- |
| `ananya.sharma@hireproof.test`        | Recruiter      |
| `rohan.mehta@hireproof.test`          | Recruiter      |
| `vikram.rao@hireproof.test`           | Delivery head  |
| `priya.nair@kestrelinfotech.test`     | Hiring manager |
| `arjun.kulkarni@sahyadrifinserv.test` | Hiring manager |

Password: `<DEMO PASSWORD, add it to the README at submission>`.

**The first load can be slow.** Render's free plan puts the API to sleep after 15 minutes without traffic. Waking takes up to about a minute. The login page says "Starting the server" when that happens; after that everything is quick. Neon also sleeps its database after a few idle minutes and wakes in about a second.

**The AI has a daily cap.** On Groq's free plan the larger model allows about 200,000 tokens a day. When it runs out, or when no key is set, scorecards and scoring fall back to rules and are labelled "Scored without AI" or "pattern matching". Nothing fails; the results are simply plainer.

**Uploads.** The free instance has 512 MB of memory, so CVs are read one at a time. A batch of 10 including scans takes about a minute and a half.

**Reset the demo.** This wipes everything, including anything reviewers uploaded, and puts the seed back. Use the same values as step 2.

PowerShell:

```powershell
$env:DATABASE_URL = "PASTE_THE_NEON_STRING_HERE"
$env:SEED_DEMO_PASSWORD = "DEMO_PASSWORD"
try { npm run db:reset } finally { Remove-Item Env:DATABASE_URL, Env:SEED_DEMO_PASSWORD }
```

bash:

```bash
DATABASE_URL='PASTE_THE_NEON_STRING_HERE' SEED_DEMO_PASSWORD='DEMO_PASSWORD' npm run db:reset
```

**If the hosted demo is down.** Run the whole product on your own machine. See "Running everything locally" below.

## 7. Troubleshooting

**The page says the server is starting, or sign-in says "The server is still starting".** The API is asleep. Wait up to a minute and try again. To wake it before a demo, open `API_ADDRESS/api/health` a minute earlier.

**Render shows the deploy as failed and the log mentions a migration.** The container applies migrations before it starts the server, and exits if one fails. Open the service's Logs. The usual causes: `DATABASE_URL` has a typo or is missing `?sslmode=require`, it is the pooled string (host contains `-pooler`), or the Neon project is paused. Fix the variable in Render's Environment tab and it redeploys. A database the seed already migrated is fine; the container finds nothing to apply.

**The service restarts again and again, or the log says "Killed" or the Events tab says out of memory.** The instance has 512 MB. Check `CV_CONCURRENCY` is `1` in Render's Environment tab. Do not upload very large batches at once; the page sends ten files at a time and the queue works through them, but each scan needs a few hundred MB while it is read.

**Every request answers 401 right after signing in, or sign-in seems to work and then bounces back to the login page.** The sign-in cookie is not being kept. Check, in order: you are opening the **Vercel** address and not the Render address; `API_INTERNAL_URL` in Vercel is exactly the Render address with no `/api` and no slash at the end (change it, then redeploy, because it is read at build time); the browser is not blocking cookies for the site. The cookie is host-only on the Vercel address and is set as secure, so it needs `https`.

**The audit log shows the same address for everyone, or the smoke test says the address is private, or the masked address does not match yours.** `TRUST_PROXY` is wrong. If the recorded address is one of Vercel's or Render's, raise it by one (for example `5`). If it is a nonsense address that you do not recognise from far outside your network, lower it. Change it in Render's Environment tab, let it redeploy, and run the smoke test again.

**Sign-in gets "Too many failed attempts".** The limiter allows ten failed attempts per address in 15 minutes. If `TRUST_PROXY` is too low the limiter counts every visitor as one address, which shows up as this error for everyone. Fix `TRUST_PROXY` as above, or wait 15 minutes.

**The AI does not seem to be used.** On a requisition the scorecard says "pattern matching", or scores say "Scored without AI". Check `LLM_API_KEY` is set in Render (a blank value counts as not set), that the key is valid, and that the daily cap has not been used. The key is never shown in the app; the API log says "AI not configured" or the provider's error.

**The Vercel build fails with a message about `@hireproof/shared`.** The Root Directory must be `apps/web` and **Include source files outside of the Root Directory** must be on. The build command builds the shared package first.

## Client addresses and TRUST_PROXY

The audit log records the address each request came from, and the sign-in limiter counts failed attempts per address. Both depend on the API seeing the **browser's** address, which only reaches it inside a header, `X-Forwarded-For`, that every proxy on the way adds to.

The path is: browser, Vercel, Render's front door (a CDN and load balancer), the container. Each hop adds the address it received the request from to the end of the list. Express reads the list from the right and skips as many entries as `TRUST_PROXY` says are proxies you trust; the next one is the client.

Render documents no hop count. Reports from people running Express on Render with nothing in front of it say the browser sits three entries from the right (Render's own layers, then the connection from the last of them), so such a service needs `3`. Vercel is one more hop between the browser and Render: from Render's point of view the "client" is now Vercel, and the browser is one entry further left. So the value is **4**.

How to read the number:

- Too low: Express stops on a proxy's address. The audit log and the limiter see Vercel or Render, not the visitor, and everyone shares one limiter bucket.
- Too high: Express runs past the real client into text the visitor typed. They could write any address in `X-Forwarded-For` and be believed.

The value was worked out from published behaviour, because the hosted stack cannot be reached from the repository, so the smoke test (step 5) and the comparison with your own address are what confirm it. The setting is read as a hop count (`TRUST_PROXY`, default `1`, which is correct for one proxy such as the local Docker setup).

Running the whole product locally with `docker compose` is different: the Next server there forwards requests without adding the visitor's address, so the API sees the web container's address for everyone. That only affects the local audit log and is why the smoke test does not check the address when the web address is `localhost`.

## Cookies and headers

- The session cookie is `HttpOnly`, `SameSite=Lax`, `Secure` in production, and has **no `Domain` attribute**, so it belongs only to the exact Vercel address. Because Vercel forwards `/api`, the browser never talks to Render directly, so the cookie is first party. This also keeps it working in Safari on iPhones.
- Pages carry `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: SAMEORIGIN`, `Permissions-Policy` (camera, microphone and location off) and a Content-Security-Policy. The policy allows inline scripts and styles because Next writes some of its own inline. The CV viewer shows the original PDF in a frame from the same address, which `frame-src 'self'` allows.
- Vercel adds `Strict-Transport-Security` itself. The smoke test checks it.
- The API sets its own headers through Helmet, hides `X-Powered-By`, and gives CV files their own strict policy.

## Memory

The free Render instance has 512 MB. The Docker image caps the JavaScript heap (`--max-old-space-size=192`) and limits glibc memory arenas (`MALLOC_ARENA_MAX=2`), which stops OCR threads from holding on to memory.

Measured with `docker stats` on a container limited to 512 MB, uploading 10 PDFs at once (3 scans, 7 text), peak memory of the API container:

| `CV_CONCURRENCY` | Peak    | Batch time |
| ---------------- | ------- | ---------- |
| 1                | 367 MiB | 89 s       |
| 2                | 462 MiB | 74 s       |

An idle container sits at about 160 MiB. Two at a time leaves too little room (90% of the limit), so `render.yaml` sets `1`. The code default is `2`, which suits a larger machine.

## Running everything locally

If the hosted demo is down, or you want to see it without any account, run the same images with Docker.

```bash
cp .env.example .env     # then fill it with the local values in the README
docker compose --profile app up --build
```

This starts Postgres, the API (built from `apps/api/Dockerfile`, limited to 512 MB like Render) and a production build of the web app. The web app is on http://localhost:3000 and the API on http://localhost:4000. Set `WEB_PORT`, `API_PORT` and `POSTGRES_PORT` in `.env` if those ports are taken.

The database starts empty. Load the demo data from your machine, with the same values you put in `.env`:

```bash
npm install
DATABASE_URL='postgresql://hireproof:hireproof_local_only@localhost:5432/hireproof' npm run db:seed
```

(Use your `POSTGRES_PORT` in the URL if you changed it.) Then open the web address and use the quick-login buttons. Use Chrome, Edge or Firefox: the cookie is marked secure, which those browsers accept on `localhost` over plain http, and Safari does not.

`npm run smoke -- --web http://localhost:3000` works against it too.

## What would change at real scale

- **A worker process.** The queue runs inside the API. At real volume, put it in its own service so heavy OCR cannot slow requests, and scale the two separately.
- **Object storage for files.** CVs are stored in Postgres. Move them to S3 or similar and keep only a key in the database; candidate deletion would then remove the object as well as the row.
- **A pooled connection for the API.** Keep the direct connection for migrations and the queue, and give the request-handling code a pooled one so many instances can share the database's connection limit.
- **A paid, always-on instance.** No sleeping means no first-load wait, and more memory means a higher `CV_CONCURRENCY`.
- **Scheduled retention.** The Data page lists candidates past the retention period; a scheduled job should delete them.
- **Real email.** Messages to candidates and clients are recorded, not sent.
