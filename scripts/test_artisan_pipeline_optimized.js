import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function testAll() {
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
    await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__artisan && window.__artisan.switchToGameMode, { timeout: 15000 });

    console.log('Switching to Game Mode...');
    await page.evaluate(() => window.__artisan.switchToGameMode());
    await new Promise(r => setTimeout(r, 2000));

    const benchmark = await page.evaluate(async () => {
      const ctx = window.__fantasticCtx;
      const r = ctx.renderer;

      // 1. Static shadow caching
      r.shadowMap.autoUpdate = false;
      r.shadowMap.needsUpdate = true;

      // 2. Light consolidation
      ctx.scene.traverse(obj => {
        if (obj.isPointLight) {
          // Keep key lights: hallGlow, hearth fire, avatar lantern, portal light
          if (obj.intensity <= 8.5 && obj.distance <= 7.5) {
            obj.visible = false;
          }
        }
      });

      // 3. DPR 0.85x
      r.setPixelRatio(0.85);

      // Settle
      for (let i = 0; i < 30; i++) await new Promise(res => requestAnimationFrame(res));

      // Measure 120 frames
      const times = [];
      for (let i = 0; i < 120; i++) {
        const t0 = performance.now();
        await new Promise(res => requestAnimationFrame(res));
        times.push(performance.now() - t0);
      }

      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      return { avgMs: avg, fps: 1000 / avg, dpr: r.getPixelRatio() };
    });

    console.log('Optimized Benchmark Result (DPR 0.85x + Static Shadows + Consolidated Lights):', benchmark);

  } catch (err) {
    console.error(err);
  } finally {
    await browser.close();
  }
}

testAll();
