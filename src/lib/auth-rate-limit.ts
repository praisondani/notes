const WINDOW_MS = 15 * 60 * 1_000;
const MAX_FAILURES = 5;
const MAX_TRACKED_KEYS = 10_000;

type RateState = {
  firstFailureAt: number;
  failures: number;
  blockedUntil: number;
};

const attempts = new Map<string, RateState>();

function boundedKey(key: string): string {
  return key.slice(0, 320);
}

function pruneAttempts(now: number): void {
  for (const [key, current] of attempts) {
    if (now - current.firstFailureAt >= WINDOW_MS && now >= current.blockedUntil) attempts.delete(key);
  }
  while (attempts.size > MAX_TRACKED_KEYS) {
    const oldest = attempts.keys().next().value;
    if (oldest === undefined) break;
    attempts.delete(oldest);
  }
}

function stateFor(key: string, now: number): RateState | undefined {
  key = boundedKey(key);
  pruneAttempts(now);
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
  key = boundedKey(key);
  const current = stateFor(key, now);
  const next: RateState = current
    ? { ...current, failures: current.failures + 1 }
    : { firstFailureAt: now, failures: 1, blockedUntil: 0 };
  if (next.failures >= MAX_FAILURES) next.blockedUntil = now + WINDOW_MS;
  attempts.set(key, next);
  pruneAttempts(now);
}

export function clearLoginRateLimits(key?: string): void {
  if (key) attempts.delete(boundedKey(key));
  else attempts.clear();
}
