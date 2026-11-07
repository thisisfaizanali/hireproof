import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/app";
import { env } from "../src/env";
import { PASSWORD, createUser, resetDb } from "./helpers";

// Anyone who reaches the API without the web app can send any X-Forwarded-For,
// and a high hop count believes it. Each request below claims a new address.
beforeAll(() => {
  app.set("trust proxy", 4);
});
afterAll(() => {
  app.set("trust proxy", env.TRUST_PROXY);
});
beforeEach(resetDb);

let n = 0;
const login = (email: string, password: string) =>
  request(app)
    .post("/api/auth/login")
    .set("X-Forwarded-For", `10.9.${Math.floor(n / 250)}.${(n++ % 250) + 1}`)
    .send({ email, password });

describe("the per-account login limit", () => {
  it("blocks a sixth failure for one email, whatever address it claims", async () => {
    const user = await createUser("RECRUITER", undefined, "a1@example.test");
    for (let i = 0; i < 5; i++) {
      expect((await login(user.email, "wrong-password")).status).toBe(401);
    }
    const res = await login(user.email, "wrong-password");
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/too many failed attempts/i);
  });

  it("then blocks the right password for that account too", async () => {
    const user = await createUser("RECRUITER", undefined, "a2@example.test");
    for (let i = 0; i < 5; i++) await login(user.email, "wrong-password");
    const res = await login(user.email, PASSWORD);
    expect(res.status).toBe(429);
  });

  it("counts the same account typed with other spacing or case", async () => {
    const user = await createUser("RECRUITER", undefined, "a3@example.test");
    const variants = [
      user.email,
      ` ${user.email} `,
      user.email.toUpperCase(),
      user.email,
      ` ${user.email.toUpperCase()}`,
    ];
    for (const email of variants) {
      expect((await login(email, "wrong-password")).status).toBe(401);
    }
    expect((await login(user.email, PASSWORD)).status).toBe(429);
  });

  it("does not block a different email from the same address", async () => {
    const locked = await createUser("RECRUITER", undefined, "a4@example.test");
    const other = await createUser("RECRUITER", undefined, "a5@example.test");
    for (let i = 0; i < 6; i++) {
      await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", "10.8.0.1")
        .send({ email: locked.email, password: "wrong-password" });
    }
    const res = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", "10.8.0.1")
      .send({ email: other.email, password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it("does not count successful sign-ins", async () => {
    const user = await createUser("RECRUITER", undefined, "a6@example.test");
    for (let i = 0; i < 8; i++) {
      expect((await login(user.email, PASSWORD)).status).toBe(200);
    }
    expect((await login(user.email, "wrong-password")).status).toBe(401);
  });

  it("falls back to the address when the email is missing or invalid", async () => {
    for (let i = 0; i < 7; i++) {
      const res = await login("not an email", "wrong-password");
      expect(res.status).toBe(400);
    }
  });
});
