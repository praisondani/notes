const WINDOW_MS = 15 * 60 * 1_000;
const MAX_FAILURES = 5;

type RateState = {
  firstFailureAt: number;
  failures: number;
  blockedUntil: number;
};

const attempts = new Map<string, RateState>();

function stateFor(key: string, now: number): RateState | undefined {
  const current = attempts.get(key);
  if (!current) return undefined;
  if (now - current.firstFailureAt >= WINDOW_MS && now >= current.blockedUntil) {
    attempts.delete(key);
    return undefined;
  }
  return current;
}

export function consumeLoginRateLimit(key: string, now = Date.now()): { allowed: true } | { allowed: false; retryAfter: number } {
  const current = stateFor(key, now);
  if (!current || now >= current.blockedUntil) return { allowed: true };
  return { allowed: false, retryAfter: Math.max(1, Math.ceil((current.blockedUntil - now) / 1_000)) };
}

export function recordLoginFailure(key: string, now = Date.now()): void {
  const current = stateFor(key, now);
  const next: RateState = current
    ? { ...current, failures: current.failures + 1 }
    : { firstFailureAt: now, failures: 1, blockedUntil: 0 };
  if (next.failures >= MAX_FAILURES) next.blockedUntil = now + WINDOW_MS;
  attempts.set(key, next);
}

export function clearLoginRateLimits(key?: string): void {
  if (key) attempts.delete(key);
  else attempts.clear();
}
