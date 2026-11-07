/* global fetch, process, console, URL, AbortSignal, setTimeout */
// Smoke test for any Hireproof deployment:
//   SMOKE_PASSWORD=... npm run smoke -- --web https://your-app.vercel.app
// The password is read from the environment only, never from an argument.
// It signs in as the demo users and exercises the main reads for each role.

const USERS = {
  recruiter: "ananya.sharma@hireproof.test",
  head: "vikram.rao@hireproof.test",
  kestrel: "priya.nair@kestrelinfotech.test",
  sahyadri: "arjun.kulkarni@sahyadrifinserv.test",
};

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const webArg = flag("web");
const password = process.env.SMOKE_PASSWORD;
if (!webArg || !password) {
  console.error(
    "Usage: SMOKE_PASSWORD=<demo password> npm run smoke -- --web <url>",
  );
  process.exit(2);
}
const web = new URL(webArg).origin;
const https = web.startsWith("https://");
const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(web);
const wakeSeconds = Number(flag("wake") ?? 120);

const failures = [];
function check(name, ok, detail = "") {
  console.log(
    `${ok ? "pass" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`,
  );
  if (!ok) failures.push(detail ? `${name}: ${detail}` : name);
  return ok;
}
const note = (text) => console.log(`note  ${text}`);
const section = (title) => console.log(`\n${title}`);

async function call(
  path,
  { method = "GET", cookie, json, timeout = 30000 } = {},
) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (json !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(web + path, {
    method,
    headers,
    body: json === undefined ? undefined : JSON.stringify(json),
    redirect: "manual",
    signal: AbortSignal.timeout(timeout),
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON (a page or a file).
  }
  return { res, text, body };
}

async function login(email) {
  const { res } = await call("/api/auth/login", {
    method: "POST",
    json: { email, password },
  });
  const setCookie = res.headers
    .getSetCookie()
    .find((c) => c.startsWith("hp_session="));
  return {
    ok: res.status === 200 && !!setCookie,
    status: res.status,
    setCookie,
  };
}

const cookieOf = (setCookie) => setCookie.split(";")[0];

// Masks an address so the line can be compared with your own without exposing it.
function mask(ip) {
  const v4 = /(\d+)\.(\d+)\.\d+\.\d+$/.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.x.x`;
  return `${ip.split(":").slice(0, 2).join(":")}::/32`;
}

function isPrivate(ip) {
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const lower = ip.toLowerCase();
  return (
    lower === "::1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe80")
  );
}

// The first request after a quiet spell can take a minute on a free host.
async function health() {
  section("Health");
  const start = Date.now();
  let last = "no answer";
  while ((Date.now() - start) / 1000 < wakeSeconds) {
    try {
      const { res, body } = await call("/api/health", { timeout: 20000 });
      last = `status ${res.status}`;
      if (res.status === 200 && body?.db === "up") {
        const waited = Math.round((Date.now() - start) / 1000);
        check(
          "API answers and the database is up",
          true,
          `${waited}s${waited > 3 ? ", it was waking" : ""}`,
        );
        check(
          "API sets nosniff and hides X-Powered-By",
          res.headers.get("x-content-type-options") === "nosniff" &&
            !res.headers.get("x-powered-by"),
        );
        return true;
      }
    } catch (err) {
      last =
        err.name === "TimeoutError"
          ? "timed out"
          : String(err.cause?.code ?? err.message);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  check(
    "API answers and the database is up",
    false,
    `gave up after ${wakeSeconds}s, last: ${last}`,
  );
  return false;
}

async function webHeaders() {
  section("Web headers");
  const { res } = await call("/login");
  const h = (k) => res.headers.get(k) ?? "";
  check("login page loads", res.status === 200, `status ${res.status}`);
  check(
    "X-Content-Type-Options is nosniff",
    h("x-content-type-options") === "nosniff",
  );
  check(
    "Referrer-Policy is strict-origin-when-cross-origin",
    h("referrer-policy") === "strict-origin-when-cross-origin",
  );
  check("X-Frame-Options is SAMEORIGIN", h("x-frame-options") === "SAMEORIGIN");
  check(
    "Permissions-Policy turns camera, microphone and geolocation off",
    ["camera", "microphone", "geolocation"].every((f) =>
      h("permissions-policy").includes(`${f}=()`),
    ),
  );
  check(
    "Content-Security-Policy is set",
    h("content-security-policy").includes("default-src 'self'") &&
      h("content-security-policy").includes("frame-ancestors 'self'"),
  );
  if (https) {
    check(
      "Strict-Transport-Security is set",
      /max-age=\d+/.test(h("strict-transport-security")),
    );
  } else {
    note("HSTS not checked, the address is not https");
  }
}

async function recruiter() {
  section("Recruiter");
  const who = await login(USERS.recruiter);
  if (!check("signs in", who.ok, `status ${who.status}`)) return;
  const attrs = who.setCookie;
  check(
    "session cookie is HttpOnly, SameSite=Lax and host-only",
    /HttpOnly/i.test(attrs) &&
      /SameSite=Lax/i.test(attrs) &&
      !/Domain=/i.test(attrs),
  );
  if (https) check("session cookie is Secure", /;\s*Secure/i.test(attrs));
  const cookie = cookieOf(attrs);

  const reqs = await call("/api/requisitions", { cookie });
  const list = Array.isArray(reqs.body) ? reqs.body : [];
  check(
    "lists requisitions",
    reqs.res.status === 200 && list.length > 0,
    `${list.length} found`,
  );
  let target;
  let row;
  for (const r of list) {
    const c = await call(`/api/requisitions/${r.id}/candidates`, { cookie });
    const found = c.body?.items?.find((i) => i.score && i.cvId);
    if (c.res.status === 200 && found) {
      target = r;
      row = found;
      break;
    }
  }
  if (!check("opens a candidate list with scores", !!target)) return;

  const score = await call(`/api/applications/${row.applicationId}/score`, {
    cookie,
  });
  check(
    "opens a score breakdown",
    score.res.status === 200 && score.body?.score?.criteria?.length > 0,
    `status ${score.res.status}`,
  );

  const file = await call(
    `/api/cvs/${row.cvId}/file?requisition=${target.id}`,
    {
      cookie,
    },
  );
  const h = (k) => file.res.headers.get(k) ?? "";
  check(
    "gets a CV file",
    file.res.status === 200 && file.text.length > 100,
    `status ${file.res.status}`,
  );
  check(
    "CV file is nosniff, uncached and has its own CSP",
    h("x-content-type-options") === "nosniff" &&
      h("cache-control").includes("no-store") &&
      h("content-security-policy").includes("default-src 'none'"),
  );
}

async function clients() {
  section("Client hiring managers");
  const sessions = {};
  for (const key of ["kestrel", "sahyadri"]) {
    const who = await login(USERS[key]);
    if (!check(`${key} signs in`, who.ok, `status ${who.status}`)) return;
    sessions[key] = cookieOf(who.setCookie);
  }
  const apps = {};
  for (const key of ["kestrel", "sahyadri"]) {
    const cookie = sessions[key];
    const reqs = await call("/api/portal/requisitions", { cookie });
    const list = Array.isArray(reqs.body) ? reqs.body : [];
    check(
      `${key} portal lists requisitions`,
      reqs.res.status === 200 && list.length > 0,
      `${list.length} found`,
    );
    let text = reqs.text;
    let app;
    for (const r of list) {
      const c = await call(`/api/portal/requisitions/${r.id}/candidates`, {
        cookie,
      });
      text += c.text;
      const first = (c.body?.items ?? c.body ?? [])[0];
      if (first) {
        app = first.applicationId ?? first.id;
        break;
      }
    }
    if (!check(`${key} sees a submitted candidate`, !!app)) continue;
    const one = await call(`/api/portal/applications/${app}`, { cookie });
    text += one.text;
    check(
      `${key} opens one application`,
      one.res.status === 200,
      `status ${one.res.status}`,
    );
    check(
      `${key} responses hold no email`,
      !/[\w.+-]+@[\w-]+\.[\w.]+/.test(text),
    );
    check(
      `${key} responses hold no 10 digit phone number`,
      !/(?<![\d.])\d{10}(?![\d.])/.test(text.replace(/[\s-]/g, "")),
    );
    check(`${key} responses hold no total score`, !/"total"\s*:/.test(text));
    apps[key] = app;
  }
  if (apps.kestrel && apps.sahyadri) {
    const a = await call(`/api/portal/applications/${apps.sahyadri}`, {
      cookie: sessions.kestrel,
    });
    const b = await call(`/api/portal/applications/${apps.kestrel}`, {
      cookie: sessions.sahyadri,
    });
    check(
      "another client's application is a 404",
      a.res.status === 404 && b.res.status === 404,
      `${a.res.status} and ${b.res.status}`,
    );
  }
}

async function head() {
  section("Delivery head");
  const who = await login(USERS.head);
  if (!check("signs in", who.ok, `status ${who.status}`)) return;
  const cookie = cookieOf(who.setCookie);
  const insights = await call("/api/insights/week", { cookie });
  check(
    "opens insights",
    insights.res.status === 200 && !!insights.body,
    `status ${insights.res.status}`,
  );
  const audit = await call("/api/audit?action=LOGIN_SUCCEEDED", { cookie });
  check(
    "opens the audit log",
    audit.res.status === 200 && Array.isArray(audit.body?.rows),
    `status ${audit.res.status}`,
  );
  const ip = audit.body?.rows?.[0]?.ip;
  if (!ip) {
    check("latest sign-in has an address", false);
  } else if (local) {
    note(
      `latest sign-in address is ${mask(ip)}. Not checked: the local web container does not forward the client address`,
    );
  } else {
    check(
      `latest sign-in address is the browser's, not a private or proxy one (${mask(ip)})`,
      !isPrivate(ip),
      "compare the masked address with your own public address",
    );
  }
}

console.log(`Smoke test against ${web}`);
if (await health()) {
  await webHeaders();
  await recruiter();
  await clients();
  await head();
}
console.log("");
if (failures.length > 0) {
  console.log(`${failures.length} failed:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("All checks passed");
