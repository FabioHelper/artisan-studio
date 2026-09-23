import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function runTest() {
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

    // Measure FPS when applying lighting consolidation & static shadows in browser
    const testResult = await page.evaluate(async () => {
      const ctx = window.__fantasticCtx;
      const r = ctx.renderer;

      // 1. Disable redundant chandelier lights (leave hallGlow to illuminate chandelier)
      let disabledChand = 0;
      ctx.scene.traverse(obj => {
        if (obj.isPointLight && obj.parent && obj.parent.name !== 'DreamGarden') {
          // Keep hallGlow and fire, consolidate individual candle point lights
          if (obj.intensity <= 8 && obj.distance <= 7.5) {
            obj.visible = false;
            disabledChand++;
          }
        }
      });

      // 2. Disable shadow autoUpdate
      r.shadowMap.autoUpdate = false;
      r.shadowMap.needsUpdate = true;
      r.shadowMap.type = 1; // THREE.PCFShadowMap

      // Measure 120 frames
      const times = [];
      for (let i = 0; i < 120; i++) {
        const t0 = performance.now();
        await new Promise(res => requestAnimationFrame(res));
        times.push(performance.now() - t0);
      }

      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const min = Math.min(...times);
      const max = Math.max(...times);
      const fps = 1000 / avg;

      return { avgMs: avg, fps, minMs: min, maxMs: max, disabledLights: disabledChand };
    });

    console.log('Optimized Performance Result:', testResult);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
}

runTest();
