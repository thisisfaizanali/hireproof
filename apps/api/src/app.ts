import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";

export const app = express();

app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "100kb" }));

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
    status < 500 && err.message
      ? err.message
      : "Internal server error";
  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV !== "production" && status >= 500
      ? { stack: String(err.stack) }
      : {}),
  });
};
app.use(errorHandler);
