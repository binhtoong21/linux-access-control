interface Entry {
  failures: number;
  windowStart: number;
  lockedUntil: number;
}

/**
 * api.md Rate Limiting: 5 failed logins per username + IP lock that key for 15 minutes.
 * In memory: one server instance (~40 workstations); a restart clears the counters.
 */
export class LoginThrottle {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 15 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  static key(username: string, ip: string): string {
    return `${username.trim().toLowerCase()}|${ip}`;
  }

  isLocked(key: string): boolean {
    const e = this.entries.get(key);
    return e !== undefined && e.lockedUntil > this.now();
  }

  recordFailure(key: string): void {
    const t = this.now();
    let e = this.entries.get(key);
    if (!e || (e.lockedUntil <= t && t - e.windowStart >= this.windowMs)) {
      e = { failures: 0, windowStart: t, lockedUntil: 0 };
      this.entries.set(key, e);
    }
    e.failures += 1;
    if (e.failures >= this.maxFailures) e.lockedUntil = t + this.windowMs;
    if (this.entries.size > 10_000) this.prune(t);
  }

  reset(key: string): void {
    this.entries.delete(key);
  }

  private prune(t: number): void {
    for (const [k, e] of this.entries) {
      if (e.lockedUntil <= t && t - e.windowStart >= this.windowMs) this.entries.delete(k);
    }
  }
}
