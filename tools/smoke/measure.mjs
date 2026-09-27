import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 414, height: 896 } });
await page.goto('http://localhost:8081/profile', { waitUntil: 'load', timeout: 180000 });
await page.waitForTimeout(12000);

const report = await page.evaluate(() => {
  const hero = [...document.querySelectorAll('*')].find((el) =>
    (getComputedStyle(el).backgroundImage || '').includes('hero'),
  );
  if (!hero) return { error: 'hero bulunamadi' };

  // Walk up from the hero so we can see which ancestor stops constraining width.
  const chain = [];
  let node = hero;
  for (let i = 0; i < 6 && node; i++) {
    const r = node.getBoundingClientRect();
    const cs = getComputedStyle(node);
    chain.push({
      tag: node.tagName,
      cls: (node.className || '').toString().slice(0, 28),
      w: Math.round(r.width),
      h: Math.round(r.height),
      maxW: cs.maxWidth,
      flex: cs.flex,
    });
    node = node.parentElement;
  }
  return { chain };
});

console.log(JSON.stringify(report, null, 1));
await browser.close();
