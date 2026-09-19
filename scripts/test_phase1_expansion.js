import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const ARTIFACTS_DIR = 'C:\\Users\\Fabio D\\.gemini\\antigravity\\brain\\69a02808-eb44-47c0-ae6f-920c8e19911a';

async function run() {
  console.log('Testing Phase 1 Layered Architectural Expansion...');
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
      '--window-size=1600,1000'
    ],
    defaultViewport: { width: 1600, height: 1000 }
  });

  try {
    const page = await browser.newPage();
    console.log('Connecting to http://localhost:5173/...');
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForFunction(() => window.__artisan && window.__artisan.loadScene, { timeout: 10000 });

    // 1. Test Hermit Library with new Scriptorium Shell & Misty Mountains Vista
    console.log('\n--- 1. Testing Hermit Library with Scriptorium Shell ---');
    await page.evaluate(() => window.__artisan.loadScene('library'));
    await new Promise(r => setTimeout(r, 2000));

    const libraryTelemetry = await page.evaluate(() => {
      const rtss = window.__artisan?.rtss;
      const renderer = window.__artisan?.renderer;
      const dpr = renderer ? renderer.getPixelRatio() : 1;
      const info = renderer?.info?.render || {};
      const t = rtss?.getTelemetry?.() || {};
      return {
        dpr,
        fps: t.fps || 60,
        frametime: t.frametime || 16.6,
        calls: info.calls || 0,
        triangles: info.triangles || 0
      };
    });

    const libOutPath = path.join(ARTIFACTS_DIR, 'library_scriptorium_expanded.png');
    await page.screenshot({ path: libOutPath });
    console.log(`✓ Saved screenshot: ${libOutPath}`);
    console.log(`  Calls: ${libraryTelemetry.calls} (Budget <= 30) | Tris: ${libraryTelemetry.triangles} | FPS: ${libraryTelemetry.fps.toFixed(1)}`);

    // 2. Test Tokyo Nintendo Office on Widescreen (1280x551) with Genkan Extension
    console.log('\n--- 2. Testing Tokyo Office on Widescreen (1280x551) with Genkan ---');
    await page.setViewport({ width: 1280, height: 551, deviceScaleFactor: 1.0 });
    await page.evaluate(() => window.__artisan.loadScene('tokyo'));
    await new Promise(r => setTimeout(r, 2000));

    const tokyoTelemetry = await page.evaluate(() => {
      const rtss = window.__artisan?.rtss;
      const renderer = window.__artisan?.renderer;
      const dpr = renderer ? renderer.getPixelRatio() : 1;
      const info = renderer?.info?.render || {};
      const t = rtss?.getTelemetry?.() || {};
      return {
        dpr,
        fps: t.fps || 60,
        frametime: t.frametime || 16.6,
        calls: info.calls || 0,
        triangles: info.triangles || 0
      };
    });

    const tokyoOutPath = path.join(ARTIFACTS_DIR, 'tokyo_widescreen_genkan.png');
    await page.screenshot({ path: tokyoOutPath });
    console.log(`✓ Saved screenshot: ${tokyoOutPath}`);
    console.log(`  Calls: ${tokyoTelemetry.calls} (Budget <= 70) | Tris: ${tokyoTelemetry.triangles} | FPS: ${tokyoTelemetry.fps.toFixed(1)}`);

  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
