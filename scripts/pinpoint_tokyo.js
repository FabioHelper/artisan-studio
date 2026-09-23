import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function pinpoint() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--use-angle=d3d11'
    ],
    defaultViewport: { width: 1280, height: 720 }
  });

  const page = await browser.newPage();
  console.log('Connecting to page...');
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__artisan && window.__artisan.loadScene, { timeout: 10000 });
  console.log('Loaded artisan studio.');

  await page.evaluate(() => window.__artisan.loadScene('tokyo'));
  await new Promise(r => setTimeout(r, 1500));

  async function getFps() {
    return await page.evaluate(async () => {
      return new Promise(resolve => {
        let count = 0, last = performance.now(), samples = [];
        function loop(now) {
          if (count > 5) samples.push(now - last);
          last = now;
          count++;
          if (count < 35) requestAnimationFrame(loop);
          else resolve(1000 / (samples.reduce((a, b) => a + b, 0) / samples.length));
        }
        requestAnimationFrame(loop);
      });
    });
  }

  const baselineFps = await getFps();
  console.log('1. Baseline Tokyo FPS:', baselineFps.toFixed(1));

  // Get entities
  const entities = await page.evaluate(() => {
    return window.__artisan.activeWorldGroup.children.map(c => ({
      name: c.name,
      type: c.type,
      childCount: c.children.length
    }));
  });
  console.log('Entities in Tokyo:', entities);

  // Hide each entity and measure
  for (const ent of entities) {
    if (!ent.name) continue;
    await page.evaluate(name => {
      const child = window.__artisan.activeWorldGroup.children.find(c => c.name === name);
      if (child) child.visible = false;
    }, ent.name);
    const fps = await getFps();
    console.log(`- Hiding ${ent.name} -> FPS: ${fps.toFixed(1)}`);
    // Restore visibility
    await page.evaluate(name => {
      const child = window.__artisan.activeWorldGroup.children.find(c => c.name === name);
      if (child) child.visible = true;
    }, ent.name);
  }

  // Now test: Hide ALL children except one by one
  console.log('\n--- Isolating Each Entity (Only that entity visible) ---');
  for (const ent of entities) {
    if (!ent.name) continue;
    await page.evaluate(name => {
      window.__artisan.activeWorldGroup.children.forEach(c => {
        c.visible = (c.name === name);
      });
    }, ent.name);
    const fps = await getFps();
    console.log(`[ONLY ${ent.name}] -> FPS: ${fps.toFixed(1)}`);
  }

  await browser.close();
}

pinpoint().catch(err => {
  console.error('ERROR in pinpoint:', err);
  process.exit(1);
});
