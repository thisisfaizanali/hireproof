import request from "supertest";
import { beforeEach, expect, it } from "vitest";
import { app } from "../src/app";
import { PASSWORD, createUser, resetDb } from "./helpers";

beforeEach(resetDb);

it("blocks login after repeated failures, even with the right password", async () => {
  const user = await createUser("RECRUITER");
  // Different emails, so only the address limit can be what stops this.
  for (let i = 0; i < 10; i++) {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: `guess${i}@example.test`, password: "wrong-password" });
    expect(res.status).toBe(401);
  }
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(429);
  expect(res.body.error).toMatch(/too many/i);
});
