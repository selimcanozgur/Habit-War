/**
 * Screen walkthrough.
 *
 * Loads every tab in a phone-sized browser, screenshots it, and reports anything the
 * page complained about. It exists because three whole classes of bug here are
 * invisible to typechecking and to the API tests:
 *
 *  - Web-only render failures. A Metro transformer wired to the wrong entry point
 *    made every SVG icon resolve to a module object, and the app rendered blank
 *    behind a green build.
 *  - Invalid DOM. react-native-web turns a Pressable into a <button>, so a nested
 *    Pressable is a nested button, which React refuses to hydrate.
 *  - Contract drift. The client normalisers degrade a missing field instead of
 *    throwing, so a renamed API field renders a plausible blank — "0 seans",
 *    "Bilinmeyen kullanıcı" — rather than an error. The placeholder scan below is
 *    what catches those.
 *
 * READ-ONLY BY CONSTRUCTION. An earlier version navigated by clicking tab labels,
 * matched "Kabul" inside the friends screen, and accepted a real friend request —
 * the check quietly destroyed the fixture it was checking. Navigation is by URL and
 * nothing here clicks. If a future check needs to drive an interaction, it belongs
 * in a test with its own fixtures, not in a walkthrough of seeded data.
 */

import { chromium } from 'playwright';

const ROUTES = [
  ['/', 'Ana Sayfa', '01-home'],
  ['/feed', 'Akış', '02-feed'],
  ['/battle', 'Savaş', '03-battle'],
  ['/friends', 'Arkadaşlar', '04-friends'],
  ['/profile', 'Profil', '05-profile'],
];

/** What a degraded normaliser renders when a field it reads is absent. */
const PLACEHOLDERS = ['Bilinmeyen kullanıcı', '0 seans', '+0 XP', 'NaN', 'undefined'];

const OUT = process.argv[2];
if (!OUT) {
  console.error('Usage: node tools/smoke/drive.mjs <screenshot-dir>');
  process.exit(1);
}

const browser = await chromium.launch();
// Phone-shaped: the layout targets a handset, and a desktop window would not show
// what a user actually meets.
const page = await browser.newPage({ viewport: { width: 414, height: 896 } });

const errors = new Set();
page.on('console', (m) => {
  if (m.type() === 'error') errors.add(m.text().split('\n')[0].slice(0, 140));
});
page.on('pageerror', (e) => errors.add('pageerror: ' + String(e).slice(0, 160)));
page.on('requestfailed', (r) => errors.add('failed: ' + r.url().replace('http://localhost:3000', 'API')));

let nestedButtons = 0;
const placeholdersSeen = new Set();

for (const [path, label, file] of ROUTES) {
  await page.goto('http://localhost:8081' + path, { waitUntil: 'load', timeout: 180000 });
  // The first visit compiles an 8 MB bundle; later ones only need the queries to land.
  await page.waitForTimeout(9000);
  await page.screenshot({ path: `${OUT}/${file}.png` });

  const body = (await page.locator('body').innerText()).replace(/\n{2,}/g, '\n').trim();
  for (const placeholder of PLACEHOLDERS) {
    if (body.includes(placeholder)) placeholdersSeen.add(`${label}: ${placeholder}`);
  }

  const nested = await page.evaluate(() => document.querySelectorAll('button button').length);
  nestedButtons += nested;

  console.log(`\n===== ${label} (${path}) =====`);
  console.log(body.slice(0, 380) || '(bos)');
  if (nested > 0) console.log(`  !! ${nested} nested button(s)`);
}

console.log('\n===== YER TUTUCU TARAMASI =====');
console.log(placeholdersSeen.size ? [...placeholdersSeen].join('\n') : '(temiz)');

console.log('\n===== IC ICE BUTON =====');
console.log(nestedButtons === 0 ? '(temiz)' : `${nestedButtons} bulundu`);

console.log('\n===== KONSOL HATALARI =====');
console.log(errors.size ? [...errors].join('\n') : '(yok)');

await browser.close();

// Non-zero so this can gate a commit or a CI step rather than only being read.
if (errors.size || nestedButtons > 0) process.exit(1);
