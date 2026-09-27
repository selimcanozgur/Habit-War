import { chromium } from 'playwright';

/**
 * Walks every screen and reports console errors.
 *
 * react-native-web renders a Pressable as a <button>, so a Pressable nested inside
 * another one is invalid HTML — an error that exists only on the web target and is
 * therefore invisible to typechecking, to the tests, and to a device.
 */
const ROUTES = ['/', '/feed', '/battle', '/friends', '/profile'];
const OUT = process.argv[2];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 414, height: 896 } });

const errors = new Set();
page.on('console', (m) => {
  if (m.type() === 'error') errors.add(m.text().split('\n')[0].slice(0, 120));
});
page.on('pageerror', (e) => errors.add('pageerror: ' + String(e).slice(0, 120)));

for (const route of ROUTES) {
  await page.goto('http://localhost:8081' + route, { waitUntil: 'load', timeout: 180000 });
  await page.waitForTimeout(9000);
  process.stdout.write(`  ${route} `);
  // Nested buttons are only detectable in the rendered DOM.
  const nested = await page.evaluate(() => document.querySelectorAll('button button').length);
  console.log(nested > 0 ? `İÇ İÇE BUTON: ${nested}` : 'temiz');
}

await page.screenshot({ path: OUT + '/pc-view.png' });
console.log('\nkonsol hatalari:', errors.size ? [...errors].join(' | ') : '(yok)');
await browser.close();
