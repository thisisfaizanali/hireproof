import { createHash } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { SessionUser } from "@hireproof/shared";
import { app } from "../src/app";
import { prisma } from "../src/db";
import { PASSWORD, createUser, loginAs, resetDb } from "./helpers";

beforeEach(resetDb);

describe("POST /api/auth/login", () => {
  it("sets an httpOnly session cookie and returns the session user", async () => {
    const user = await createUser("CLIENT_HM");
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email.toUpperCase(), password: PASSWORD });

    expect(res.status).toBe(200);
    expect(SessionUser.parse(res.body)).toMatchObject({
      id: user.id,
      role: "CLIENT_HM",
      client: { name: "Test Client" },
    });
    const cookie = (res.headers["set-cookie"] as unknown as string[])[0];
    expect(cookie).toMatch(/^hp_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);

    const token = cookie.split(";")[0].slice("hp_session=".length);
    const stored = await prisma.session.findFirstOrThrow();
    expect(stored.tokenHash).toBe(
      createHash("sha256").update(token).digest("hex"),
    );
    expect(stored.tokenHash).not.toBe(token);
  });

  it("gives the same 401 for a wrong password and an unknown email", async () => {
    const user = await createUser("RECRUITER");
    const wrongPassword = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: "not-the-password" });
    const unknownEmail = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@example.test", password: PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(wrongPassword.body.error).toBe("Email or password is incorrect");
    expect(wrongPassword.headers["set-cookie"]).toBeUndefined();
  });

  it("keeps the password exactly as typed, spaces included", async () => {
    const user = await createUser("RECRUITER", "  spaced out  ");
    const exact = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: "  spaced out  " });
    const trimmed = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: "spaced out" });
    expect(exact.status).toBe(200);
    expect(trimmed.status).toBe(401);
  });

  it("rejects a body that fails validation", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "not-an-email", password: "" });
    expect(res.status).toBe(400);
  });

  it("rejects a non-JSON body before it reaches the handler", async () => {
    const user = await createUser("RECRUITER");
    const res = await request(app)
      .post("/api/auth/login")
      .type("form")
      .send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(415);
    expect(await prisma.session.count()).toBe(0);
  });

  it("writes audit events for success and failure", async () => {
    const user = await createUser("RECRUITER");
    await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: "wrong-password" });
    await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: PASSWORD });

    const events = await prisma.auditEvent.findMany({
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => e.action)).toEqual([
      "LOGIN_FAILED",
      "LOGIN_SUCCEEDED",
    ]);
    expect(events[0].meta).toEqual({ email: user.email });
    expect(JSON.stringify(events[0])).not.toContain("wrong-password");
    expect(events[1].actorId).toBe(user.id);
  });
});

describe("GET /api/auth/me", () => {
  it("is 401 without a cookie", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns the user with a valid cookie", async () => {
    const { user, cookie } = await loginAs("DELIVERY_HEAD");
    const res = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: user.id, role: "DELIVERY_HEAD" });
  });

  it("rejects an expired session and deletes it", async () => {
    const { cookie } = await loginAs("RECRUITER");
    await prisma.session.updateMany({ data: { expiresAt: new Date(0) } });
    const res = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(res.status).toBe(401);
    expect(await prisma.session.count()).toBe(0);
  });
});

describe("POST /api/auth/logout", () => {
  it("invalidates the session and clears the cookie", async () => {
    const { cookie } = await loginAs("RECRUITER");
    const res = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", cookie)
      .send({});
    expect(res.status).toBe(204);
    expect((res.headers["set-cookie"] as unknown as string[])[0]).toMatch(
      /^hp_session=;/,
    );
    expect(await prisma.session.count()).toBe(0);

    const after = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(after.status).toBe(401);

    const actions = (await prisma.auditEvent.findMany()).map((e) => e.action);
    expect(actions).toContain("LOGOUT");
  });
});
