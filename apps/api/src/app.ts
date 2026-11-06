import cookieParser from "cookie-parser";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { auth } from "./auth";
import { candidates } from "./candidates";
import { clients } from "./clients";
import { env } from "./env";
import { health } from "./health";
import { requisitions } from "./requisitions";
import { uploads } from "./uploads";

export const app = express();

app.disable("x-powered-by");
// The web app proxies /api, so the client address arrives in X-Forwarded-For.
app.set("trust proxy", 1);
app.use(helmet());
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

// Multipart is how the browser uploads a file. Only these routes accept it, and
// only with a header that a cross-site form cannot set.
const MULTIPART_ROUTES = [
  /^POST \/api\/requisitions$/,
  /^POST \/api\/uploads\/[^/]+\/files$/,
];

// SameSite=Lax keeps the session cookie off cross-site POSTs. This also rejects
// state-changing requests that are not JSON, since a cross-site page cannot send
// application/json without a CORS preflight, which this API never approves.
app.use("/api", (req, res, next) => {
  const type = req.get("content-type") ?? "";
  const isJson = /^application\/json\b/i.test(type);
  const isUpload =
    /^multipart\/form-data\b/i.test(type) &&
    MULTIPART_ROUTES.some((route) =>
      route.test(`${req.method} ${req.baseUrl}${req.path}`),
    ) &&
    req.get("x-requested-with") === "hireproof";
  if (req.method === "GET" || req.method === "HEAD" || isJson || isUpload) {
    next();
    return;
  }
  res.status(415).json({ error: "Content-Type must be application/json" });
});

app.use(health);
app.use(auth);
app.use(clients);
app.use(requisitions);
app.use(uploads);
app.use(candidates);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status =
    typeof err.status === "number" && err.status >= 400 && err.status < 600
      ? err.status
      : 500;
  // Client errors (bad JSON, body too large) are safe to explain. Anything else
  // is logged and reported generically so internals never reach the response.
  if (status >= 500) console.error(err);
  const message =
    status < 500 && err.message ? err.message : "Internal server error";
  res.status(status).json({
    error: message,
    ...(env.NODE_ENV !== "production" && status >= 500
      ? { stack: String(err.stack) }
      : {}),
  });
};
app.use(errorHandler);
