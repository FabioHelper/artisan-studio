import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function testConfig() {
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
  // Laptop native viewport: 1280x551, deviceScaleFactor: 1.0 (or 1.25)
  await page.setViewport({ width: 1280, height: 551, deviceScaleFactor: 1.0 });
  await page.goto('http://localhost:5173/?mode=game', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));
  await page.evaluate(() => document.getElementById('veil')?.click());
  await new Promise(r => setTimeout(r, 1000));

  const results = await page.evaluate(async () => {
    const ctx = window.__fantasticCtx;
    // 1. Ensure exterior is fully visible
    if (ctx.exterior) ctx.exterior.visible = true;
    window.__artisanDisableBloom = false;

    // Measure at DPR 1.0
    ctx.renderer.setPixelRatio(1.0);
    if (ctx.composer) {
      ctx.composer.setPixelRatio(1.0);
      ctx.composer.setSize(window.innerWidth, window.innerHeight);
    }

    const samples = [];
    let last = performance.now();
    await new Promise(resolve => {
      let count = 0;
      function loop(t) {
        const dt = t - last;
        last = t;
        if (count > 10) samples.push(dt);
        count++;
        if (count < 80) requestAnimationFrame(loop);
        else resolve();
      }
      requestAnimationFrame(loop);
    });

    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    return {
      avgFps: (1000 / avg).toFixed(1),
      avgMs: avg.toFixed(2),
      exteriorVisible: ctx.exterior?.visible,
      bloomEnabled: !window.__artisanDisableBloom,
      dpr: ctx.renderer.getPixelRatio()
    };
  });

  console.log('Results at DPR 1.0 Native + Full Exterior + Full Bloom:', results);

  // Take screenshot to inspect visual quality
  await page.screenshot({ path: 'C:\\Users\\Fabio D\\.gemini\\antigravity\\brain\\69a02808-eb44-47c0-ae6f-920c8e19911a\\fantastic_quality_restored.png' });
  console.log('Saved screenshot: fantastic_quality_restored.png');

  await browser.close();
}

testConfig().catch(console.error);
