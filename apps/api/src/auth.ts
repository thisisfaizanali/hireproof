import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { Router, type CookieOptions, type RequestHandler } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { LoginInput, type Role, type SessionUser } from "@hireproof/shared";
import { audit } from "./audit";
import { prisma } from "./db";
import { env } from "./env";
import type { Client, User } from "./generated/prisma/client";

declare module "express-serve-static-core" {
  interface Request {
    user?: SessionUser;
  }
}

export const SESSION_COOKIE = "hp_session";
const SESSION_DAYS = 7;
const BAD_LOGIN = "Email or password is incorrect";

const cookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: env.NODE_ENV === "production",
  path: "/",
};

// Compared against when the email is unknown, so a miss costs the same time as a hit.
const dummyHash = bcrypt.hashSync("not-a-real-password", 10);

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

function toSessionUser(user: User & { client: Client | null }): SessionUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    client: user.client && { id: user.client.id, name: user.client.name },
  };
}

async function findSession(token: unknown) {
  if (typeof token !== "string") return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { client: true } } },
  });
  if (!session) return null;
  if (session.expiresAt <= new Date()) {
    // deleteMany so a concurrent request deleting the same row is not an error.
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }
  return session;
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  const session = await findSession(req.cookies?.[SESSION_COOKIE]);
  if (!session) {
    res.status(401).json({ error: "Not signed in" });
    return;
  }
  req.user = toSessionUser(session.user);
  next();
};

export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: "Not allowed" });
      return;
    }
    next();
  };

const TOO_MANY = {
  error: "Too many failed attempts. Try again in a few minutes.",
};

// Only failed attempts count, so a shared office IP is not locked out by normal use.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: TOO_MANY,
});

// The address can be forged by anyone who reaches the API without going through
// the web app, so guessing is also capped per account. A missing or invalid email
// falls back to the address.
const accountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: TOO_MANY,
  keyGenerator: (req) => {
    const email = LoginInput.shape.email.safeParse(req.body?.email);
    return email.success ? `email:${email.data}` : ipKeyGenerator(req.ip ?? "");
  },
});

export const auth = Router();

auth.post("/api/auth/login", loginLimiter, accountLimiter, async (req, res) => {
  const input = LoginInput.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "Enter a valid email and password" });
    return;
  }
  const { email, password } = input.data;

  const user = await prisma.user.findUnique({
    where: { email },
    include: { client: true },
  });
  const passwordOk = await bcrypt.compare(
    password,
    user?.passwordHash ?? dummyHash,
  );

  if (!user || !passwordOk) {
    // The account is stored as an id, never the email that was typed.
    await audit({
      action: "LOGIN_FAILED",
      ...(user && { entityType: "User", entityId: user.id }),
      ip: req.ip,
    });
    res.status(401).json({ error: BAD_LOGIN });
    return;
  }

  const token = randomBytes(32).toString("base64url");
  const maxAge = SESSION_DAYS * 24 * 60 * 60 * 1000;
  await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + maxAge),
    },
  });
  await audit({
    action: "LOGIN_SUCCEEDED",
    actorId: user.id,
    entityType: "User",
    entityId: user.id,
    ip: req.ip,
  });

  res.cookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge });
  res.json(toSessionUser(user));
});

auth.post("/api/auth/logout", async (req, res) => {
  const session = await findSession(req.cookies?.[SESSION_COOKIE]);
  if (session) {
    await prisma.session.delete({ where: { id: session.id } });
    await audit({
      action: "LOGOUT",
      actorId: session.userId,
      entityType: "User",
      entityId: session.userId,
      ip: req.ip,
    });
  }
  res.clearCookie(SESSION_COOKIE, cookieOptions);
  res.status(204).end();
});

auth.get("/api/auth/me", requireAuth, (req, res) => {
  res.json(req.user);
});
