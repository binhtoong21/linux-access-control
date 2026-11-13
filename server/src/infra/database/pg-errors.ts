/** True when `err` is a PostgreSQL unique violation (23505), optionally on one named constraint or index. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string } | null;
  return !!e && e.code === '23505' && (constraint === undefined || e.constraint === constraint);
}
