/**
 * Feature flags.
 *
 * One place to switch a whole feature off without deleting it. A flag defaults to the
 * shipped decision and can be overridden for local work through an EXPO_PUBLIC_ env
 * var, which Expo inlines at build time — e.g. `EXPO_PUBLIC_FEATURE_DUELS=1 npx expo
 * start` brings duels back on one machine without touching anyone else's build.
 */

function flag(envValue: string | undefined, fallback: boolean): boolean {
  if (envValue === '1' || envValue === 'true') return true;
  if (envValue === '0' || envValue === 'false') return false;
  return fallback;
}

export const FEATURES = {
  /**
   * Duels: the Düello tab of the add sheet, the duel list and composer on Savaş, and
   * the duel tasks on Bugün. Off while the product focuses on solo habits first; the
   * API keeps serving them, so turning this back on needs no server change.
   */
  duels: flag(process.env.EXPO_PUBLIC_FEATURE_DUELS, false),
  /**
   * The social feed tab. Off while v1 is single-player (docs/game-design.md §0); the
   * friends tab stays for adding and removing friends.
   */
  feed: flag(process.env.EXPO_PUBLIC_FEATURE_FEED, false),
} as const;
