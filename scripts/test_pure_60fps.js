import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function testPure60FPS() {
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
    
    // Wait for warmup frames so all shaders are fully compiled
    console.log('Warming up shaders for 2 seconds...');
    await new Promise(r => setTimeout(r, 2000));

    const result = await page.evaluate(async () => {
      const ctx = window.__fantasticCtx;
      const r = ctx.renderer;

      // 1. Static shadow caching (moon doesn't move, eliminate 2048x2048 depth pass every frame)
      r.shadowMap.autoUpdate = false;
      r.shadowMap.needsUpdate = true;

      // 2. Consolidate redundant individual candle lights
      // The chandelier and sconces have their flame meshes; we leave hallGlow and fire
      let hiddenLights = 0;
      ctx.scene.traverse(obj => {
        if (obj.isPointLight) {
          // Keep hallGlow, hearth fire, avatar lantern, portal light
          if (obj.intensity <= 8.5 && obj.distance <= 7.5) {
            obj.visible = false;
            hiddenLights++;
          }
        }
      });

      // 3. Disable bloom for raw 60fps baseline measurement
      window.__artisanDisableBloom = true;

      // Let it settle for 60 frames
      for (let i = 0; i < 60; i++) {
        await new Promise(res => requestAnimationFrame(res));
      }

      // Now record clean 120 frames without any warmup or compilation hitches
      const times = [];
      for (let i = 0; i < 120; i++) {
        const t0 = performance.now();
        await new Promise(res => requestAnimationFrame(res));
        times.push(performance.now() - t0);
      }

      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const min = Math.min(...times);
      const max = Math.max(...times);
      const sorted = [...times].sort((a, b) => a - b);
      const p95 = sorted[Math.floor(sorted.length * 0.95)];

      return {
        avgMs: avg,
        fps: 1000 / avg,
        minMs: min,
        maxMs: max,
        p95Ms: p95,
        hiddenLights,
        drawCalls: r.info.render.calls,
        triangles: r.info.render.triangles
      };
    });

    console.log('=== PURE OPTIMIZATION BENCHMARK ===', result);

  } catch (err) {
    console.error(err);
  } finally {
    await browser.close();
  }
}

testPure60FPS();
