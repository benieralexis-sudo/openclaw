import { chromium } from 'playwright';

const URLS = [
  { path: '/', name: 'home' },
  { path: '/tarifs', name: 'tarifs' },
  { path: '/produit', name: 'produit' },
  { path: '/a-propos', name: 'a-propos' },
];

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

const browser = await chromium.launch({ headless: true });
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
  for (const u of URLS) {
    const page = await ctx.newPage();
    try {
      const resp = await page.goto(`http://127.0.0.1:3100${u.path}`, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForTimeout(800); // laisser les anims se stabiliser
      await page.screenshot({ path: `/tmp/screenshots/${u.name}-${vp.name}.png`, fullPage: true });
      console.log(`OK ${u.name}-${vp.name} HTTP=${resp?.status()}`);
    } catch (e) {
      console.log(`FAIL ${u.name}-${vp.name}: ${e.message}`);
    } finally {
      await page.close();
    }
  }
  await ctx.close();
}
await browser.close();
console.log('done');
