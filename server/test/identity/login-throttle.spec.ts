import { LoginThrottle } from '../../src/identity/login-throttle';

describe('LoginThrottle', () => {
  let t = 0;
  const throttle = () => new LoginThrottle(5, 15 * 60_000, () => t);
  beforeEach(() => {
    t = 1_000_000;
  });

  it('locks a key on the 5th failure and only that key', () => {
    const th = throttle();
    const k = LoginThrottle.key(' Root ', '10.0.0.1');
    expect(k).toBe('root|10.0.0.1');
    for (let i = 0; i < 4; i++) th.recordFailure(k);
    expect(th.isLocked(k)).toBe(false);
    th.recordFailure(k);
    expect(th.isLocked(k)).toBe(true);
    expect(th.isLocked(LoginThrottle.key('root', '10.0.0.2'))).toBe(false);
  });

  it('unlocks after 15 minutes with a fresh counter', () => {
    const th = throttle();
    const k = 'a|ip';
    for (let i = 0; i < 5; i++) th.recordFailure(k);
    t += 15 * 60_000;
    expect(th.isLocked(k)).toBe(false);
    th.recordFailure(k);
    expect(th.isLocked(k)).toBe(false);
  });

  it('forgets failures older than the window', () => {
    const th = throttle();
    const k = 'b|ip';
    for (let i = 0; i < 4; i++) th.recordFailure(k);
    t += 15 * 60_000;
    th.recordFailure(k);
    expect(th.isLocked(k)).toBe(false);
  });

  it('reset clears the failures', () => {
    const th = throttle();
    const k = 'c|ip';
    for (let i = 0; i < 4; i++) th.recordFailure(k);
    th.reset(k);
    th.recordFailure(k);
    expect(th.isLocked(k)).toBe(false);
  });
});
