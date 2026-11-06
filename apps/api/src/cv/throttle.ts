import { ProviderError, type RateLimits } from "../ai/llm";

// Longest the queue will sit still for the provider. A reset further away than
// this (a daily budget, say) means "give up on AI for this CV", not "wait".
const MAX_WAIT_MS = 90_000;
const RETRIES = 3;

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

// One shared gate for every LLM call the CV jobs make. Calls run one at a
// time. After each response the provider's own headers say how much of the
// token and request budgets is left, and the next call waits for the reset
// when the budget is too low for it.
export class Throttle {
  private tail: Promise<unknown> = Promise.resolve();
  private remainingTokens: number | null = null;
  private tokensResetAt = 0;
  private remainingRequests: number | null = null;
  private requestsResetAt = 0;

  constructor(private readonly clock: Clock = realClock) {}

  run<T extends { limits?: RateLimits | null }>(
    estimateTokens: number,
    call: () => Promise<T>,
  ): Promise<T> {
    const result = this.tail.then(() => this.attempt(estimateTokens, call));
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async attempt<T extends { limits?: RateLimits | null }>(
    estimate: number,
    call: () => Promise<T>,
  ): Promise<T> {
    for (let tries = 0; ; tries++) {
      await this.waitForBudget(estimate);
      try {
        const result = await call();
        this.observe(result.limits);
        return result;
      } catch (err) {
        if (!(err instanceof ProviderError) || !err.retryable) throw err;
        const wait = err.retryAfterMs ?? 2000 * 2 ** tries;
        if (tries >= RETRIES || wait > MAX_WAIT_MS) throw err;
        await this.clock.sleep(wait);
      }
    }
  }

  private async waitForBudget(estimate: number) {
    let now = this.clock.now();
    if (
      this.remainingRequests !== null &&
      this.remainingRequests < 1 &&
      now < this.requestsResetAt
    ) {
      const wait = this.requestsResetAt - now;
      if (wait > MAX_WAIT_MS) {
        throw new ProviderError("The AI request limit has been reached", false);
      }
      await this.clock.sleep(wait);
      now = this.clock.now();
    }
    if (
      this.remainingTokens !== null &&
      this.remainingTokens < estimate &&
      now < this.tokensResetAt
    ) {
      await this.clock.sleep(Math.min(this.tokensResetAt - now, MAX_WAIT_MS));
    }
  }

  private observe(limits: RateLimits | null | undefined) {
    if (!limits) return;
    const now = this.clock.now();
    this.remainingTokens = limits.remainingTokens;
    this.tokensResetAt = now + (limits.resetTokensMs ?? 0);
    this.remainingRequests = limits.remainingRequests;
    this.requestsResetAt = now + (limits.resetRequestsMs ?? 0);
  }
}

export const cvThrottle = new Throttle();
