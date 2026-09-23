import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function diagnoseDiorama() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-webgl', '--ignore-gpu-blocklist']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1.25 });

  console.log('Navigating to http://localhost:5173/ (Diorama Mode)...');
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));

  const info = await page.evaluate(() => {
    return {
      activeScene: window.__artisan?.scene?.name || 'artisan-scene',
      childrenCount: window.__artisan?.scene?.children?.length,
      dprPreset: window.__artisan?.getDPRPreset?.(),
      effectiveDPR: window.__artisan?.computeEffectiveDPR?.(),
      pixelRatio: window.__artisan?.renderer?.getPixelRatio(),
      envReflections: window.__artisan?.engineConfig?.envReflections,
      fillRateLimiter: window.__artisan?.engineConfig?.fillRateLimiter
    };
  });
  console.log('Diorama Info:', info);

  async function benchmarkFPS() {
    return page.evaluate(async () => {
      const times = [];
      let last = performance.now();
      await new Promise(resolve => {
        let count = 0;
        function loop(t) {
          const dt = t - last;
          last = t;
          if (count > 5) times.push(dt);
          count++;
          if (count < 65) requestAnimationFrame(loop);
          else resolve();
        }
        requestAnimationFrame(loop);
      });
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      return { fps: (1000 / avg).toFixed(1), avgMs: avg.toFixed(2), minMs: Math.min(...times).toFixed(2), maxMs: Math.max(...times).toFixed(2) };
    });
  }

  const baseline = await benchmarkFPS();
  console.log('Diorama Laptop Baseline (Forge Trio):', baseline);

  // Test other scenes
  for (const sc of ['tavern', 'alchemist', 'armory', 'tokyo', 'winterhold']) {
    await page.evaluate((name) => window.__artisan.loadScene(name), sc);
    await new Promise(r => setTimeout(r, 500));
    const res = await benchmarkFPS();
    console.log(`Diorama Scene [${sc}]: FPS = ${res.fps}, frametime = ${res.avgMs} ms`);
  }

  await browser.close();
}

diagnoseDiorama().catch(console.error);
