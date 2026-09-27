import { chromium } from 'playwright';

const OUT = process.argv[2];
/**
 * Navigated by URL rather than by clicking the tab bar. expo-router maps each screen
 * to a path on web, and the dev-server error overlay sits on top of the tab bar —
 * so a click-driven walk stops at the first warning and silently re-screenshots the
 * previous screen.
 */
const ROUTES = [
  ['/', 'Ana Sayfa', '01-home'],
  ['/feed', 'Akış', '02-feed'],
  ['/battle', 'Savaş', '03-battle'],
  ['/friends', 'Arkadaşlar', '04-friends'],
  ['/profile', 'Profil', '05-profile'],
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 414, height: 896 } });

const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 200)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text().split('\n')[0].slice(0, 140));
});
page.on('requestfailed', (r) => errors.push('failed: ' + r.url().replace('http://localhost:3000', 'API')));

for (const [path, label, file] of ROUTES) {
  await page.goto('http://localhost:8081' + path, { waitUntil: 'load', timeout: 180000 });
  await page.waitForTimeout(12000);
  await page.screenshot({ path: `${OUT}/${file}.png` });

  const body = (await page.locator('body').innerText()).replace(/\n{2,}/g, '\n').trim();
  console.log(`\n===== ${label} (${path}) =====`);
  console.log(body.slice(0, 420) || '(bos)');
}

console.log('\n===== HATALAR =====');
console.log([...new Set(errors)].slice(0, 12).join('\n') || '(yok)');

await browser.close();
