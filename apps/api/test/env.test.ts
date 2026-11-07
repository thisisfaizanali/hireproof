import { describe, expect, it } from "vitest";
import { app } from "../src/app";
import { env, loadEnv } from "../src/env";

const base = { PORT: "4000", DATABASE_URL: "postgresql://x" };

describe("proxy and concurrency settings", () => {
  it("reads TRUST_PROXY as a hop count and defaults to one", () => {
    expect(loadEnv({ ...base, TRUST_PROXY: "4" }).TRUST_PROXY).toBe(4);
    expect(loadEnv({ ...base, TRUST_PROXY: "" }).TRUST_PROXY).toBe(1);
    expect(loadEnv(base).TRUST_PROXY).toBe(1);
    expect(() => loadEnv({ ...base, TRUST_PROXY: "many" })).toThrow();
  });

  it("gives the setting to Express", () => {
    expect(app.get("trust proxy")).toBe(env.TRUST_PROXY);
  });

  it("reads CV_CONCURRENCY and defaults to two", () => {
    expect(loadEnv({ ...base, CV_CONCURRENCY: "1" }).CV_CONCURRENCY).toBe(1);
    expect(loadEnv(base).CV_CONCURRENCY).toBe(2);
    expect(() => loadEnv({ ...base, CV_CONCURRENCY: "0" })).toThrow();
  });
});
