/**
 * Icon set generator.
 *
 * The icons are generated rather than hand-placed so the whole set shares one grid
 * and one stroke weight by construction: 24x24, 2px, round caps and joins. A set
 * assembled from several sources drifts on exactly those three things, and the drift
 * is what makes an interface look bought rather than designed.
 *
 * Everything uses `currentColor`, so one file serves an active tab, an inactive tab
 * and a disabled state without duplication.
 *
 * Run: node tools/icons/generate.mjs apps/mobile/assets/icons
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const STROKE =
  'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const SOLID = 'fill="currentColor"';

function svg(body, { solid = false } = {}) {
  const attrs = solid ? SOLID : STROKE;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" ${attrs}>\n${body}\n</svg>\n`;
}

const icons = {
  // --- Navigation: the five tabs, outline and filled ------------------------
  'navigation/today': svg(
    `  <path d="M3 10.5 12 3l9 7.5"/>
  <path d="M5.5 9.5V20h13V9.5"/>
  <path d="M9.5 20v-5.5h5V20"/>`,
  ),
  'navigation/today-filled': svg(
    `  <path d="M12 2.2 2.4 10a1 1 0 0 0 .64 1.77H4.5V20a1 1 0 0 0 1 1h4v-6h5v6h4a1 1 0 0 0 1-1v-8.23h1.46A1 1 0 0 0 21.6 10Z"/>`,
    { solid: true },
  ),

  // A figure with supporters behind it: the feed is other people's progress.
  'navigation/feed': svg(
    `  <circle cx="12" cy="6" r="2.6"/>
  <path d="M7.5 20v-1.8a4.5 4.5 0 0 1 9 0V20"/>
  <path d="M3.5 20v-1a3 3 0 0 1 2.2-2.9"/>
  <path d="M20.5 20v-1a3 3 0 0 0-2.2-2.9"/>`,
  ),
  'navigation/feed-filled': svg(
    `  <circle cx="12" cy="6" r="2.9"/>
  <path d="M12 11.2a5.2 5.2 0 0 0-5.2 5.2V20a1 1 0 0 0 1 1h8.4a1 1 0 0 0 1-1v-3.6A5.2 5.2 0 0 0 12 11.2Z"/>
  <path d="M4.6 14.2A3.4 3.4 0 0 0 2.5 17.3V20a1 1 0 0 0 1 1h1.6v-4.6c0-.77.17-1.5.5-2.2Z"/>
  <path d="M19.4 14.2c.33.7.5 1.43.5 2.2V21h1.6a1 1 0 0 0 1-1v-2.7a3.4 3.4 0 0 0-2.1-3.1Z"/>`,
    { solid: true },
  ),

  // Crossed swords — duels.
  'navigation/battle': svg(
    `  <path d="M4 3.5h3l11 11"/>
  <path d="M20 3.5h-3l-11 11"/>
  <path d="M3.5 19.5 6 22l2.5-2.5L6 17Z"/>
  <path d="M20.5 19.5 18 22l-2.5-2.5L18 17Z"/>`,
  ),
  'navigation/battle-filled': svg(
    `  <path d="M3.4 2.6a1 1 0 0 0-.9 1.5l1.6 3.2 9.3 9.3 2.6-2.6-9.3-9.3-3.3-2ZM20.6 2.6l-3.3 2-2.3 2.3 2.6 2.6 2.3-2.3 1.6-3.1a1 1 0 0 0-.9-1.5Z"/>
  <path d="M6.1 16.1 2.8 19.4a1 1 0 0 0 0 1.4l1.4 1.4a1 1 0 0 0 1.4 0l3.3-3.3ZM17.9 16.1l-2.8 2.8 3.3 3.3a1 1 0 0 0 1.4 0l1.4-1.4a1 1 0 0 0 0-1.4Z"/>`,
    { solid: true },
  ),

  'navigation/friends': svg(
    `  <circle cx="9" cy="7.5" r="3"/>
  <path d="M3 20v-1.4A5.6 5.6 0 0 1 8.6 13h.8a5.6 5.6 0 0 1 5.6 5.6V20"/>
  <path d="M17 8.5h4"/>
  <path d="M19 6.5v4"/>`,
  ),
  'navigation/friends-filled': svg(
    `  <circle cx="9" cy="7.5" r="3.4"/>
  <path d="M9.4 12.4h-.8A6.6 6.6 0 0 0 2 19v1a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a6.6 6.6 0 0 0-6.6-6.6Z"/>
  <path d="M20 7.5h-1.2V6.3a1 1 0 0 0-2 0v1.2H15.6a1 1 0 0 0 0 2h1.2v1.2a1 1 0 0 0 2 0V9.5H20a1 1 0 0 0 0-2Z"/>`,
    { solid: true },
  ),

  // A shield — the profile is the character sheet.
  'navigation/profile': svg(
    `  <path d="M12 3 5 5.8v5.4c0 4.3 2.9 8.2 7 9.3 4.1-1.1 7-5 7-9.3V5.8Z"/>
  <circle cx="12" cy="10.5" r="2.2"/>
  <path d="M8.6 16.4a4 4 0 0 1 6.8 0"/>`,
  ),
  'navigation/profile-filled': svg(
    `  <path d="M12.35 2.07a1 1 0 0 0-.7 0l-7 2.8A1 1 0 0 0 4 5.8v5.4c0 4.77 3.22 9.08 7.74 10.29a1 1 0 0 0 .52 0C16.78 20.28 20 15.97 20 11.2V5.8a1 1 0 0 0-.65-.93Zm-.35 4.9a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6Zm0 11.7a5.6 5.6 0 0 1-4.3-2 5 5 0 0 1 8.6 0 5.6 5.6 0 0 1-4.3 2Z"/>`,
    { solid: true },
  ),

  // --- Stats: one glyph per RPG attribute -----------------------------------
  'stats/strength': svg(
    `  <path d="M4 9.5v5"/>
  <path d="M7 7v10"/>
  <path d="M17 7v10"/>
  <path d="M20 9.5v5"/>
  <path d="M7 12h10"/>`,
  ),
  'stats/endurance': svg(
    `  <path d="M12 21c-4.2-2.6-7-6.1-7-9.8A4.2 4.2 0 0 1 12 8a4.2 4.2 0 0 1 7 3.2c0 3.7-2.8 7.2-7 9.8Z"/>
  <path d="M3 12.5h3l1.5-3 2 5 1.5-2.5"/>`,
  ),
  'stats/intelligence': svg(
    `  <path d="M12 4.2a4.2 4.2 0 0 0-4.2 4.2c-1.4.7-2.3 2-2.3 3.6a3.9 3.9 0 0 0 2.2 3.5A3.4 3.4 0 0 0 11 19.5h1V4.2Z"/>
  <path d="M12 4.2a4.2 4.2 0 0 1 4.2 4.2c1.4.7 2.3 2 2.3 3.6a3.9 3.9 0 0 1-2.2 3.5 3.4 3.4 0 0 1-3.3 4H12"/>`,
  ),
  'stats/wisdom': svg(
    `  <path d="M12 3c3.5 2.6 5.5 5.6 5.5 8.6A5.5 5.5 0 0 1 12 17a5.5 5.5 0 0 1-5.5-5.4C6.5 8.6 8.5 5.6 12 3Z"/>
  <path d="M12 21v-4"/>
  <path d="M9.5 11.8a2.5 2.5 0 0 0 2.5 2.4"/>`,
  ),
  'stats/charisma': svg(
    `  <path d="M12 20.3 4.9 13.6a4.4 4.4 0 0 1 .3-6.6 4.6 4.6 0 0 1 6.1.5l.7.8.7-.8a4.6 4.6 0 0 1 6.1-.5 4.4 4.4 0 0 1 .3 6.6Z"/>`,
  ),
  'stats/dexterity': svg(`  <path d="M13.5 2.5 5 13.2h5.6l-.8 8.3L18.5 10h-5.6Z"/>`),

  // --- Categories: what a habit is about ------------------------------------
  'categories/fitness': svg(
    `  <path d="M4 9.5v5"/>
  <path d="M7 7v10"/>
  <path d="M17 7v10"/>
  <path d="M20 9.5v5"/>
  <path d="M7 12h10"/>`,
  ),
  'categories/study': svg(
    `  <path d="M12 6.8C10.4 5.4 8.3 4.8 5.5 5A1 1 0 0 0 4.5 6v11a1 1 0 0 0 1.1 1c2.5-.2 4.6.3 6.4 1.6"/>
  <path d="M12 6.8c1.6-1.4 3.7-2 6.5-1.8a1 1 0 0 1 1 1v11a1 1 0 0 1-1.1 1c-2.5-.2-4.6.3-6.4 1.6"/>
  <path d="M12 6.8v12.8"/>`,
  ),
  'categories/mindfulness': svg(
    `  <path d="M12 21c-4.5 0-7.5-3-7.5-7.5C4.5 8 8 4 12 3c4 1 7.5 5 7.5 10.5C19.5 18 16.5 21 12 21Z"/>
  <path d="M12 21V9"/>
  <path d="M12 13.5 15.5 10"/>
  <path d="M12 16.5 8.5 13"/>`,
  ),
  'categories/creative': svg(
    `  <path d="M15.5 3.5 20.5 8.5 8.8 20.2a2 2 0 0 1-1 .55l-4 .8.8-4a2 2 0 0 1 .55-1Z"/>
  <path d="m13.5 5.5 5 5"/>`,
  ),
  'categories/social': svg(
    `  <path d="M20 13.5a2.5 2.5 0 0 1-2.5 2.5H8l-4 3.5V6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5Z"/>
  <path d="M8.5 9.5h7"/>
  <path d="M8.5 12.5h4"/>`,
  ),
  'categories/health': svg(
    `  <path d="M12 20.3 4.9 13.6a4.4 4.4 0 0 1 .3-6.6 4.6 4.6 0 0 1 6.1.5l.7.8.7-.8a4.6 4.6 0 0 1 6.1-.5 4.4 4.4 0 0 1 .3 6.6Z"/>
  <path d="M6.5 12.5h3l1.5-2.5 2 4 1.5-1.5h3"/>`,
  ),
  'categories/skill': svg(
    `  <path d="M14.5 6.5 17 4l3 3-2.5 2.5"/>
  <path d="m17.5 9.5-9 9-3.5.5.5-3.5 9-9"/>
  <path d="m12.5 8.5 3 3"/>`,
  ),

  // --- UI: the small vocabulary every screen shares --------------------------
  'ui/flame': svg(
    `  <path d="M12 21c3.6 0 6-2.3 6-5.4 0-3.7-3-5.3-3.6-9.6-1.6 1.2-2.4 2.8-2.4 4.5-1-.8-1.6-2-1.8-3.5C8.3 8.6 6 11 6 15.6 6 18.7 8.4 21 12 21Z"/>`,
  ),
  'ui/flame-filled': svg(
    `  <path d="M14.9 5.2a1 1 0 0 0-1.6.2c-1.3 2.2-1.4 3.6-1.3 4.6-.6-.7-1-1.6-1.15-2.7a1 1 0 0 0-1.6-.63C7.1 8.4 5 10.9 5 15.6 5 19.4 7.9 22 12 22s7-2.6 7-6.4c0-2.5-1-4.1-1.9-5.5-.9-1.4-1.6-2.5-2.2-4.9Z"/>`,
    { solid: true },
  ),
  'ui/xp-bolt': svg(`  <path d="M13.5 2.5 5 13.2h5.6l-.8 8.3L18.5 10h-5.6Z"/>`),
  'ui/xp-bolt-filled': svg(
    `  <path d="M14.4 2.1a1 1 0 0 0-1.68-.24L4.22 12.57A1 1 0 0 0 5 14.2h4.5l-.7 7.2a1 1 0 0 0 1.78.72l8.5-11.5A1 1 0 0 0 18.3 9h-4.6Z"/>`,
    { solid: true },
  ),
  'ui/star': svg(
    `  <path d="m12 3.5 2.6 5.3 5.9.85-4.25 4.15 1 5.85L12 16.9l-5.25 2.75 1-5.85L3.5 9.65l5.9-.85Z"/>`,
  ),
  'ui/star-filled': svg(
    `  <path d="m12.9 3.1 2.35 4.76 5.25.77a1 1 0 0 1 .55 1.7l-3.8 3.7.9 5.24a1 1 0 0 1-1.45 1.05L12 17.86l-4.7 2.47a1 1 0 0 1-1.45-1.05l.9-5.24-3.8-3.7a1 1 0 0 1 .55-1.7l5.25-.77L11.1 3.1a1 1 0 0 1 1.8 0Z"/>`,
    { solid: true },
  ),
  'ui/check-circle': svg(
    `  <circle cx="12" cy="12" r="9"/>
  <path d="m8 12.2 2.8 2.8L16 9.8"/>`,
  ),
  'ui/check-circle-filled': svg(
    `  <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.7 8.2-5.2 5.2a1 1 0 0 1-1.4 0l-2.8-2.8a1 1 0 0 1 1.4-1.42l2.1 2.1 4.5-4.5a1 1 0 1 1 1.4 1.42Z"/>`,
    { solid: true },
  ),
  'ui/heart': svg(
    `  <path d="M12 20.3 4.9 13.6a4.4 4.4 0 0 1 .3-6.6 4.6 4.6 0 0 1 6.1.5l.7.8.7-.8a4.6 4.6 0 0 1 6.1-.5 4.4 4.4 0 0 1 .3 6.6Z"/>`,
  ),
  'ui/heart-filled': svg(
    `  <path d="M12.7 6.9 12 7.7l-.7-.8a5.6 5.6 0 0 0-7.44-.6 5.4 5.4 0 0 0-.36 8.1l7.8 7.35a1 1 0 0 0 1.4 0l7.8-7.35a5.4 5.4 0 0 0-.36-8.1 5.6 5.6 0 0 0-7.44.6Z"/>`,
    { solid: true },
  ),
  'ui/comment': svg(
    `  <path d="M20 13.5a2.5 2.5 0 0 1-2.5 2.5H8l-4 3.5V6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5Z"/>`,
  ),
  'ui/settings': svg(
    `  <circle cx="12" cy="12" r="3"/>
  <path d="M19.1 14.4a1.5 1.5 0 0 0 .3 1.7l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.5 1.5 0 0 0-1.7-.3 1.5 1.5 0 0 0-.9 1.4V20a1.9 1.9 0 1 1-3.8 0v-.1a1.5 1.5 0 0 0-1-1.4 1.5 1.5 0 0 0-1.7.3l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1a1.5 1.5 0 0 0 .3-1.7 1.5 1.5 0 0 0-1.4-.9H4a1.9 1.9 0 1 1 0-3.8h.1a1.5 1.5 0 0 0 1.4-1 1.5 1.5 0 0 0-.3-1.7l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1.1a1.5 1.5 0 0 0 1.7.3h.1a1.5 1.5 0 0 0 .9-1.4V4a1.9 1.9 0 1 1 3.8 0v.1a1.5 1.5 0 0 0 .9 1.4h.1a1.5 1.5 0 0 0 1.7-.3l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.5 1.5 0 0 0-.3 1.7v.1a1.5 1.5 0 0 0 1.4.9h.1a1.9 1.9 0 1 1 0 3.8H20a1.5 1.5 0 0 0-1.4.9Z"/>`,
  ),
  'ui/search': svg(
    `  <circle cx="11" cy="11" r="7"/>
  <path d="m20 20-3.9-3.9"/>`,
  ),
  'ui/chevron-left': svg(`  <path d="m14.5 5-7 7 7 7"/>`),
  'ui/chevron-right': svg(`  <path d="m9.5 5 7 7-7 7"/>`),
  'ui/chevron-down': svg(`  <path d="m5 9.5 7 7 7-7"/>`),
  'ui/arrow-left': svg(
    `  <path d="M20 12H4"/>
  <path d="m10 6-6 6 6 6"/>`,
  ),
  'ui/plus': svg(
    `  <path d="M12 5v14"/>
  <path d="M5 12h14"/>`,
  ),
  'ui/minus': svg(`  <path d="M5 12h14"/>`),
  'ui/play': svg(`  <path d="M8 5.5v13l10-6.5Z"/>`),
  'ui/play-filled': svg(
    `  <path d="M8.6 4.66A1 1 0 0 0 7 5.5v13a1 1 0 0 0 1.6.84l10-6.5a1 1 0 0 0 0-1.68Z"/>`,
    { solid: true },
  ),
  'ui/clock': svg(
    `  <circle cx="12" cy="12" r="9"/>
  <path d="M12 7v5.2l3.2 2"/>`,
  ),
  'ui/hourglass': svg(
    `  <path d="M7 3h10"/>
  <path d="M7 21h10"/>
  <path d="M7.5 3v3.2c0 1.1.5 2.1 1.3 2.8L12 12l-3.2 3c-.8.7-1.3 1.7-1.3 2.8V21"/>
  <path d="M16.5 3v3.2c0 1.1-.5 2.1-1.3 2.8L12 12l3.2 3c.8.7 1.3 1.7 1.3 2.8V21"/>`,
  ),
  'ui/bar-chart': svg(
    `  <path d="M5 20V13"/>
  <path d="M12 20V6"/>
  <path d="M19 20v-4.5"/>`,
  ),
  'ui/repeat': svg(
    `  <path d="M4 10a5 5 0 0 1 5-5h11"/>
  <path d="m16.5 1.5 3.5 3.5-3.5 3.5"/>
  <path d="M20 14a5 5 0 0 1-5 5H4"/>
  <path d="m7.5 22.5-3.5-3.5 3.5-3.5"/>`,
  ),
  'ui/trophy': svg(
    `  <path d="M8 4h8v5a4 4 0 0 1-8 0Z"/>
  <path d="M8 6H5.5A1.5 1.5 0 0 0 4 7.5C4 9.4 5.6 11 7.5 11H8"/>
  <path d="M16 6h2.5A1.5 1.5 0 0 1 20 7.5c0 1.9-1.6 3.5-3.5 3.5H16"/>
  <path d="M12 13v3.5"/>
  <path d="M8.5 20h7"/>
  <path d="M10 16.5h4v3.5h-4Z"/>`,
  ),
  'ui/medal': svg(
    `  <circle cx="12" cy="14.5" r="5"/>
  <path d="M8.5 3 10 9.7"/>
  <path d="M15.5 3 14 9.7"/>`,
  ),
  'ui/bell': svg(
    `  <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16S18 14 18 9Z"/>
  <path d="M13.7 19.5a2 2 0 0 1-3.4 0"/>`,
  ),
  'ui/shield-check': svg(
    `  <path d="M12 3 5 5.8v5.4c0 4.3 2.9 8.2 7 9.3 4.1-1.1 7-5 7-9.3V5.8Z"/>
  <path d="m9 11.8 2.2 2.2L15.2 10"/>`,
  ),
  'ui/logout': svg(
    `  <path d="M9.5 20.5H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h3.5"/>
  <path d="m15.5 8 4 4-4 4"/>
  <path d="M19.5 12h-10"/>`,
  ),
  'ui/at-sign': svg(
    `  <circle cx="12" cy="12" r="4"/>
  <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>`,
  ),
  'ui/user': svg(
    `  <circle cx="12" cy="8" r="3.5"/>
  <path d="M5 20v-1a5.5 5.5 0 0 1 5.5-5.5h3A5.5 5.5 0 0 1 19 19v1"/>`,
  ),
  'ui/ellipsis': svg(
    `  <circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none"/>
  <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>
  <circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none"/>`,
  ),
  'ui/info': svg(
    `  <circle cx="12" cy="12" r="9"/>
  <path d="M12 11v5"/>
  <path d="M12 7.8h.01"/>`,
  ),
  'ui/alert': svg(
    `  <circle cx="12" cy="12" r="9"/>
  <path d="M12 7.5v5"/>
  <path d="M12 16.2h.01"/>`,
  ),
  'ui/cloud-off': svg(
    `  <path d="M6.5 18.5a4.5 4.5 0 0 1-.9-8.9A6 6 0 0 1 16 7.6"/>
  <path d="M17.5 10.2a4.2 4.2 0 0 1 1.6 8"/>
  <path d="m3 3 18 18"/>`,
  ),
  'ui/palette': svg(
    `  <path d="M12 3a9 9 0 0 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8Z"/>
  <circle cx="7.5" cy="11" r="1.1" fill="currentColor" stroke="none"/>
  <circle cx="10" cy="7" r="1.1" fill="currentColor" stroke="none"/>
  <circle cx="15" cy="7.5" r="1.1" fill="currentColor" stroke="none"/>`,
  ),
  'ui/lock': svg(
    `  <rect x="4.5" y="10.5" width="15" height="10" rx="2"/>
  <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>`,
  ),
  'ui/headset': svg(
    `  <path d="M4 14v-2a8 8 0 0 1 16 0v2"/>
  <path d="M4 14.5h2a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z"/>
  <path d="M20 14.5h-2a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1Z"/>`,
  ),
  'ui/compass': svg(
    `  <circle cx="12" cy="12" r="9"/>
  <path d="m15.5 8.5-2 5-5 2 2-5Z"/>`,
  ),
  'ui/edit': svg(
    `  <path d="M15.5 3.5 20.5 8.5 8.8 20.2a2 2 0 0 1-1 .55l-4 .8.8-4a2 2 0 0 1 .55-1Z"/>
  <path d="m13.5 5.5 5 5"/>`,
  ),
  'ui/swords': svg(
    `  <path d="M4 3.5h3l11 11"/>
  <path d="M20 3.5h-3l-11 11"/>
  <path d="M3.5 19.5 6 22l2.5-2.5L6 17Z"/>
  <path d="M20.5 19.5 18 22l-2.5-2.5L18 17Z"/>`,
  ),
};

const root = process.argv[2];
if (!root) {
  console.error('Usage: node tools/icons/generate.mjs <output-dir>');
  process.exit(1);
}

let written = 0;
for (const [path, body] of Object.entries(icons)) {
  const [folder, name] = path.split('/');
  mkdirSync(join(root, folder), { recursive: true });
  writeFileSync(join(root, folder, `${name}.svg`), body, 'utf8');
  written++;
}

console.log(`${written} icons written to ${root}`);
