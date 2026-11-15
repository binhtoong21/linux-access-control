import { RateLimiter } from '../../src/shared/http/rate-limiter';

describe('RateLimiter', () => {
  it('allows max requests per key and window, then again in the next window', () => {
    let now = 1_000;
    const limiter = new RateLimiter(3, 60_000, () => now);
    expect([limiter.allow('a'), limiter.allow('a'), limiter.allow('a'), limiter.allow('a')]).toEqual([true, true, true, false]);
    expect(limiter.allow('b')).toBe(true);
    now += 59_999;
    expect(limiter.allow('a')).toBe(false);
    now += 1;
    expect(limiter.allow('a')).toBe(true);
  });

  it('forgets everything on reset', () => {
    const limiter = new RateLimiter(1, 60_000, () => 0);
    expect([limiter.allow('a'), limiter.allow('a')]).toEqual([true, false]);
    limiter.reset();
    expect(limiter.allow('a')).toBe(true);
  });
});
