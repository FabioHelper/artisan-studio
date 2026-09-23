import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function run() {
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
    ]
  });

  const page = await browser.newPage();
  // Exact user resolution and scale factor from their screenshot
  await page.setViewport({ width: 1280, height: 551, deviceScaleFactor: 1.25 });
  await page.goto('http://localhost:5173/?mode=game', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));
  await page.evaluate(() => document.getElementById('veil')?.click());
  await new Promise(r => setTimeout(r, 1500));

  async function measure(name) {
    return page.evaluate(async (lbl) => {
      const samples = [];
      let last = performance.now();
      await new Promise(resolve => {
        let count = 0;
        function loop(t) {
          const dt = t - last;
          last = t;
          if (count > 5) samples.push(dt);
          count++;
          if (count < 65) requestAnimationFrame(loop);
          else resolve();
        }
        requestAnimationFrame(loop);
      });
      const avgDt = samples.reduce((a, b) => a + b, 0) / samples.length;
      const sorted = [...samples].sort((a, b) => a - b);
      const p99 = sorted[Math.floor(sorted.length * 0.95)];
      const r = window.__fantasticCtx?.renderer;
      return {
        preset: lbl,
        fps: (1000 / avgDt).toFixed(1),
        frametimeMs: avgDt.toFixed(2),
        p99Ms: p99.toFixed(2),
        dpr: r?.getPixelRatio(),
        pixelWidth: r?.domElement?.width,
        pixelHeight: r?.domElement?.height
      };
    }, name);
  }

  // 1. Fresh boot in AUTO mode
  console.log('1. AUTO Boot:', await measure('AUTO 60'));

  // 2. Click QUALITY to cycle to PERF
  await page.evaluate(() => {
    window.__artisan?.cycleQuality?.();
  });
  await new Promise(r => setTimeout(r, 1200));
  console.log('2. After switching to PERF:', await measure('PERF'));

  // Capture screenshot of user's game mode at 60 FPS
  const shotPath = 'C:\\Users\\Fabio D\\.gemini\\antigravity\\brain\\69a02808-eb44-47c0-ae6f-920c8e19911a\\fantastic_user_verified_60fps.png';
  await page.screenshot({ path: shotPath });
  console.log('Saved verification screenshot to:', shotPath);

  await browser.close();
}

run().catch(console.error);
