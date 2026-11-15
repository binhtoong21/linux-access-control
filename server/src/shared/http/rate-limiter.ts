/**
 * Fixed-window request limiter (api.md "Rate Limiting"). In memory: one server instance, a restart clears the counters.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts one request for `key`; false when the key has used up its window. */
  allow(key: string): boolean {
    const t = this.now();
    let w = this.windows.get(key);
    if (!w || t - w.start >= this.windowMs) {
      w = { start: t, count: 0 };
      this.windows.set(key, w);
      if (this.windows.size > 10_000) this.prune(t);
    }
    w.count += 1;
    return w.count <= this.max;
  }

  /** Forgets every counter (tests). */
  reset(): void {
    this.windows.clear();
  }

  private prune(t: number): void {
    for (const [key, w] of this.windows) {
      if (t - w.start >= this.windowMs) this.windows.delete(key);
    }
  }
}
