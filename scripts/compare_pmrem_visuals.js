import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const ARTIFACTS_DIR = 'C:\\Users\\Fabio D\\.gemini\\antigravity\\brain\\69a02808-eb44-47c0-ae6f-920c8e19911a';

async function test() {
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
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__artisan && window.__artisan.loadScene);

  // Test Tokyo
  await page.evaluate(() => {
    window.__artisan.switchToDioramaMode();
    window.__artisan.loadScene('tokyo');
  });
  await new Promise(r => setTimeout(r, 1200));

  // 1. With PMREM (current)
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'tokyo_with_pmrem.png') });

  // 2. Without PMREM
  await page.evaluate(() => {
    window.__artisan.scene.environment = null;
  });
  await new Promise(r => setTimeout(r, 1200));
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'tokyo_without_pmrem.png') });

  // Test Winterhold
  await page.evaluate(() => {
    window.__artisan.loadScene('winterhold');
  });
  await new Promise(r => setTimeout(r, 1200));
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'winterhold_without_pmrem.png') });

  // Measure FPS for all 7 scenes WITHOUT PMREM on 1280x720 AND 1920x1080!
  const scenes = ['trio', 'tavern', 'alchemist', 'armory', 'library', 'tokyo', 'winterhold'];
  console.log('\n--- BENCHMARK WITHOUT PMREM (1280x720) ---');
  for (const s of scenes) {
    await page.evaluate(id => {
      window.__artisan.scene.environment = null;
      window.__artisan.loadScene(id);
    }, s);
    await new Promise(r => setTimeout(r, 1000));
    const res = await page.evaluate(async () => {
      return new Promise(resolve => {
        const samples = [];
        let count = 0;
        let last = performance.now();
        function loop(now) {
          const dt = now - last;
          last = now;
          if (count > 5) samples.push(dt);
          count++;
          if (count < 45) {
            requestAnimationFrame(loop);
          } else {
            const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
            resolve(1000 / avg);
          }
        }
        requestAnimationFrame(loop);
      });
    });
    console.log(`[${s}] 720p FPS: ${res.toFixed(1)}`);
  }

  // Now test 1080p
  await page.setViewport({ width: 1920, height: 1080 });
  await page.evaluate(() => {
    window.__artisan.renderer.setSize(1920, 1080);
    window.__artisan.renderer.setPixelRatio(1.0);
  });
  console.log('\n--- BENCHMARK WITHOUT PMREM (1920x1080 Native 1.0x) ---');
  for (const s of scenes) {
    await page.evaluate(id => {
      window.__artisan.scene.environment = null;
      window.__artisan.loadScene(id);
    }, s);
    await new Promise(r => setTimeout(r, 1000));
    const res = await page.evaluate(async () => {
      return new Promise(resolve => {
        const samples = [];
        let count = 0;
        let last = performance.now();
        function loop(now) {
          const dt = now - last;
          last = now;
          if (count > 5) samples.push(dt);
          count++;
          if (count < 45) {
            requestAnimationFrame(loop);
          } else {
            const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
            resolve(1000 / avg);
          }
        }
        requestAnimationFrame(loop);
      });
    });
    console.log(`[${s}] 1080p FPS: ${res.toFixed(1)}`);
  }

  await browser.close();
}

test().catch(console.error);
