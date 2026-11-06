import { describe, expect, it, vi } from "vitest";
import { ProviderError, parseDuration } from "../src/ai/llm";
import { Throttle } from "../src/cv/throttle";
import { fakeClock } from "./cvHelpers";

const result = (remainingTokens: number, resetTokensMs = 0) => ({
  limits: {
    remainingTokens,
    resetTokensMs,
    remainingRequests: 900,
    resetRequestsMs: 60_000,
  },
});

describe("Throttle", () => {
  it("waits for the token budget to reset when it is too low for the next call", async () => {
    const clock = fakeClock();
    const throttle = new Throttle(clock);
    await throttle.run(1000, async () => result(300, 12_000));
    await throttle.run(1000, async () => result(7000));
    expect(clock.slept).toEqual([12_000]);
  });

  it("does not wait when the budget covers the next call", async () => {
    const clock = fakeClock();
    const throttle = new Throttle(clock);
    await throttle.run(1000, async () => result(5000, 8000));
    await throttle.run(1000, async () => result(4000));
    expect(clock.slept).toEqual([]);
  });

  it("runs calls one at a time in order", async () => {
    const throttle = new Throttle(fakeClock());
    const order: string[] = [];
    const slow = throttle.run(1, async () => {
      await Promise.resolve();
      order.push("a");
      return {};
    });
    const fast = throttle.run(1, async () => {
      order.push("b");
      return {};
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(["a", "b"]);
  });

  it("waits for retry-after on a 429 and tries again", async () => {
    const clock = fakeClock();
    const call = vi
      .fn()
      .mockRejectedValueOnce(new ProviderError("429", true, 7000, 429))
      .mockResolvedValue({});
    await new Throttle(clock).run(1, call);
    expect(call).toHaveBeenCalledTimes(2);
    expect(clock.slept).toEqual([7000]);
  });

  it("gives up at once when the provider asks for a very long wait", async () => {
    const clock = fakeClock();
    const call = vi
      .fn()
      .mockRejectedValue(new ProviderError("429", true, 600_000, 429));
    await expect(new Throttle(clock).run(1, call)).rejects.toThrow("429");
    expect(call).toHaveBeenCalledTimes(1);
    expect(clock.slept).toEqual([]);
  });

  it("stops retrying after its budget", async () => {
    const clock = fakeClock();
    const call = vi
      .fn()
      .mockRejectedValue(new ProviderError("429", true, 1000, 429));
    await expect(new Throttle(clock).run(1, call)).rejects.toThrow("429");
    expect(call).toHaveBeenCalledTimes(4);
  });

  it("does not retry an error that retrying cannot fix", async () => {
    const call = vi.fn().mockRejectedValue(new ProviderError("401", false));
    await expect(new Throttle(fakeClock()).run(1, call)).rejects.toThrow();
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("keeps going after one call fails", async () => {
    const throttle = new Throttle(fakeClock());
    await expect(
      throttle.run(1, async () => {
        throw new ProviderError("bad", false);
      }),
    ).rejects.toThrow();
    await expect(throttle.run(1, async () => ({}))).resolves.toEqual({});
  });
});

describe("parseDuration", () => {
  it.each([
    ["7.66s", 7660],
    ["1m26.4s", 86_400],
    ["250ms", 250],
    ["2h", 7_200_000],
    ["5m45.6s", 345_600],
  ])("reads %s", (text, ms) => {
    expect(parseDuration(text)).toBe(ms);
  });

  it("returns null for anything else", () => {
    expect(parseDuration("soon")).toBeNull();
    expect(parseDuration(null)).toBeNull();
  });
});
