/**
 * Drops keys whose value is `undefined`.
 *
 * Needed because the project runs with `exactOptionalPropertyTypes`, while Prisma's
 * update inputs treat an explicitly-undefined key as a type error. Loosening the
 * compiler flag instead would give up the guarantee everywhere else in the codebase.
 */
export function definedOnly<T extends object>(input: T): { [K in keyof T]-?: Exclude<T[K], undefined> } {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) output[key] = value;
  }
  return output as { [K in keyof T]-?: Exclude<T[K], undefined> };
}
