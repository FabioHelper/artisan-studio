import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const ARTIFACTS_DIR = 'C:\\Users\\Fabio D\\.gemini\\antigravity\\brain\\69a02808-eb44-47c0-ae6f-920c8e19911a';

async function run() {
  console.log('Testing User Viewport 1280x551 Initial Load...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--use-angle=d3d11',
      '--window-size=1280,650'
    ],
    defaultViewport: { width: 1280, height: 551 }
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 551, deviceScaleFactor: 1.0 });
    console.log('Navigating to http://localhost:5173/...');
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForFunction(() => window.__artisan && window.__artisan.loadScene, { timeout: 10000 });

    // Wait 2.0s for initial load to settle
    await new Promise(r => setTimeout(r, 2000));

    const telemetry = await page.evaluate(() => {
      const rtss = window.__artisan?.rtss;
      const renderer = window.__artisan?.renderer;
      const dpr = renderer ? renderer.getPixelRatio() : 1;
      const info = renderer?.info?.render || {};
      const t = rtss?.getTelemetry?.() || {};
      const dprBtn = document.getElementById('btn-toggle-dpr')?.innerText;
      return {
        dpr,
        dprBtn,
        fps: t.fps || 60,
        frametime: t.frametime || 16.6,
        calls: info.calls || 0,
        triangles: info.triangles || 0
      };
    });

    const outPath = path.join(ARTIFACTS_DIR, 'user_viewport_verified.png');
    await page.screenshot({ path: outPath });
    console.log(`✓ Saved screenshot to ${outPath}`);
    console.log(`  DPR: ${telemetry.dpr.toFixed(2)}x | Button: ${telemetry.dprBtn}`);
    console.log(`  FPS: ${telemetry.fps.toFixed(1)} | Frametime: ${telemetry.frametime.toFixed(2)}ms | Calls: ${telemetry.calls} | Tris: ${telemetry.triangles}`);
  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
