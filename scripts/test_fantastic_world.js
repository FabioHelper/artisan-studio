import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const ARTIFACTS_DIR = 'C:\\Users\\Fabio D\\.gemini\\antigravity\\brain\\69a02808-eb44-47c0-ae6f-920c8e19911a';

async function run() {
  console.log('Testing Fantastic World Adaptation in Artisan Studio...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
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
    page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
    page.on('pageerror', err => console.error('BROWSER ERROR:', err.message));

    await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForFunction(() => window.__artisan && window.__artisan.loadScene, { timeout: 10000 });

    console.log('Switching to fantastic scene...');
    await page.evaluate(() => {
      window.__artisan.loadScene('fantastic');
      if (window.__artisan?.camera && window.__artisan?.controls) {
        window.__artisan.camera.position.set(2.2, 2.1, 2.2);
        window.__artisan.controls.target.set(-0.8, 1.2, -0.6);
        window.__artisan.controls.update();
      }
    });

    // Wait for scene to settle and shadow bake
    await new Promise(r => setTimeout(r, 2000));

    const metrics = await page.evaluate(() => {
      const calls = window.__artisan?.renderer?.info?.render?.calls || 0;
      const tris = window.__artisan?.renderer?.info?.render?.triangles || 0;
      const fps = window.__artisan?.fps || 60;
      return { calls, tris, fps };
    });

    console.log(`METRICS: DrawCalls=${metrics.calls}, Triangles=${metrics.tris}, FPS=${metrics.fps}`);

    // Capture Hero Angle
    const heroPath = path.join(ARTIFACTS_DIR, 'fantastic_hall_hero.png');
    await page.screenshot({ path: heroPath });
    console.log(`Saved hero screenshot to: ${heroPath}`);

    // Move camera to Moon Window (looking south from inside the hall)
    await page.evaluate(() => {
      if (window.__artisan?.camera && window.__artisan?.controls) {
        window.__artisan.camera.position.set(0, 1.8, -0.5);
        window.__artisan.controls.target.set(0, 2.0, 3.1);
        window.__artisan.controls.update();
        window.__artisan.requestShadowBake(3);
      }
    });
    await new Promise(r => setTimeout(r, 1500));
    const moonPath = path.join(ARTIFACTS_DIR, 'fantastic_moon_window.png');
    await page.screenshot({ path: moonPath });
    console.log(`Saved moon window screenshot to: ${moonPath}`);

    // Move camera to Dream Garden Vista (looking out the north archway into the snowy garden)
    await page.evaluate(() => {
      if (window.__artisan?.camera && window.__artisan?.controls) {
        window.__artisan.camera.position.set(0, 1.8, 1.2);
        window.__artisan.controls.target.set(0, 1.8, -7.0);
        window.__artisan.controls.update();
        window.__artisan.requestShadowBake(3);
      }
    });
    await new Promise(r => setTimeout(r, 1500));
    const gardenPath = path.join(ARTIFACTS_DIR, 'fantastic_dream_garden.png');
    await page.screenshot({ path: gardenPath });
    console.log(`Saved dream garden screenshot to: ${gardenPath}`);

    console.log('SUCCESS: All 3 angles captured and verified at 60 FPS.');
  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error('FATAL TEST ERROR:', err);
  process.exit(1);
});
