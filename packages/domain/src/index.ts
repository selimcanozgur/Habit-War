/**
 * @habitwar/domain — pure game rules.
 *
 * Zero runtime dependencies, no I/O, no clock reads. Everything here is a pure
 * function, which is what lets the API, the background jobs and the mobile client
 * agree on the same numbers.
 */

export * from './types.js';
export * from './balance.js';
export * from './leveling.js';
export * from './scoring.js';
export * from './stats.js';
export * from './streaks.js';
