import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const ARTIFACTS_DIR = 'C:\\Users\\Fabio D\\.gemini\\antigravity\\brain\\69a02808-eb44-47c0-ae6f-920c8e19911a';

async function run() {
  console.log('Connecting to browser to measure Winterhold...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--window-size=1600,1000'
    ],
    defaultViewport: { width: 1600, height: 1000 }
  });

  try {
    const page = await browser.newPage();
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
    await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForFunction(() => window.__artisan && window.__artisan.loadScene, { timeout: 10000 });
    console.log('✓ App loaded.');

    // Switch to Winterhold scene
    console.log('Switching to Winterhold College scene...');
    await page.evaluate(() => {
      window.__artisan.loadScene('winterhold');
    });

    // Wait 3 seconds for compilation, shaders, and shadow bake to settle
    await new Promise(r => setTimeout(r, 3000));

    // Enable RTSS if not visible
    await page.evaluate(() => {
      if (window.__artisan?.rtss && !window.__artisan.rtss.visible) {
        window.__artisan.rtss.toggle();
      }
    });

    // Collect 60 frame samples
    const metrics = await page.evaluate(async () => {
      const samples = [];
      let last = performance.now();
      for (let i = 0; i < 60; i++) {
        await new Promise(r => requestAnimationFrame(r));
        const now = performance.now();
        samples.push(now - last);
        last = now;
      }
      const calls = window.__artisan.renderer.info.render.calls;
      const tris = window.__artisan.renderer.info.render.triangles;
      const geometries = window.__artisan.renderer.info.memory.geometries;
      const avgFrametime = samples.reduce((a, b) => a + b, 0) / samples.length;
      return { calls, tris, geometries, avgFrametime, fps: 1000 / avgFrametime };
    });

    console.log('====================================================');
    console.log('WINTERHOLD COLLEGE METRICS AFTER COMPOUNDING:');
    console.log(`  - Draw Calls: ${metrics.calls} (Was 290 before!)`);
    console.log(`  - Triangles: ${metrics.tris}`);
    console.log(`  - Geometries: ${metrics.geometries}`);
    console.log(`  - Frametime: ${metrics.avgFrametime.toFixed(2)} ms (${metrics.fps.toFixed(1)} FPS)`);
    console.log('====================================================');

    const screenshotPath = path.join(ARTIFACTS_DIR, 'winterhold_rtss_optimized.png');
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`✓ Saved Winterhold RTSS screenshot: ${screenshotPath}`);

  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
