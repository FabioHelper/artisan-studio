import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const ARTIFACTS_DIR = 'C:\\Users\\Fabio D\\.gemini\\antigravity\\brain\\69a02808-eb44-47c0-ae6f-920c8e19911a';

async function run() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=d3d11', '--window-size=1280,650'],
    defaultViewport: { width: 1280, height: 551 }
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 551, deviceScaleFactor: 1.0 });
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForFunction(() => window.__artisan && window.__artisan.loadScene, { timeout: 10000 });

    // Test framing adjustment: camera (3.0, 2.3, 3.1), target (-0.1, 1.1, -0.1)
    await page.evaluate(() => {
      const cam = window.__artisan.camera;
      const ctrl = window.__artisan.controls;
      cam.position.set(3.0, 2.3, 3.1);
      ctrl.target.set(-0.1, 1.1, -0.1);
      ctrl.update();
    });

    await new Promise(r => setTimeout(r, 600));

    const outPath = path.join(ARTIFACTS_DIR, 'tokyo_framing_test.png');
    await page.screenshot({ path: outPath });
    console.log(`Saved framing test screenshot to ${outPath}`);
  } finally {
    await browser.close();
  }
}

run();
