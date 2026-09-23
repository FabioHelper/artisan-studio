import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function diagnose() {
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
    page.on('console', msg => console.log('[BROWSER]', msg.text()));

    console.log('Navigating to http://localhost:5173/ ...');
    await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__artisan && window.__artisan.switchToGameMode, { timeout: 15000 });

    console.log('Switching to Game Mode...');
    await page.evaluate(() => window.__artisan.switchToGameMode());
    await new Promise(r => setTimeout(r, 2000));

    const baselineTelemetry = await page.evaluate(async () => {
      const times = [];
      for (let i = 0; i < 60; i++) {
        const t0 = performance.now();
        await new Promise(r => requestAnimationFrame(r));
        times.push(performance.now() - t0);
      }
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const p99 = [...times].sort((a, b) => a - b)[Math.floor(times.length * 0.99)];
      const calls = window.__fantasticCtx?.renderer?.info?.render?.calls;
      const tris = window.__fantasticCtx?.renderer?.info?.render?.triangles;
      const dpr = window.__fantasticCtx?.renderer?.getPixelRatio();
      const shadowAuto = window.__fantasticCtx?.renderer?.shadowMap?.autoUpdate;
      const hasComposer = !!window.__fantasticCtx?.composer;
      return { avgMs: avg, fps: 1000 / avg, p99Ms: p99, calls, tris, dpr, shadowAuto, hasComposer };
    });

    console.log('Baseline Game Telemetry:', baselineTelemetry);

    // Test without Bloom
    console.log('\nTesting with Bloom disabled...');
    const noBloomTelemetry = await page.evaluate(async () => {
      window.__artisanDisableBloom = true;
      await new Promise(r => setTimeout(r, 500));
      const times = [];
      for (let i = 0; i < 60; i++) {
        const t0 = performance.now();
        await new Promise(r => requestAnimationFrame(r));
        times.push(performance.now() - t0);
      }
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      window.__artisanDisableBloom = false;
      return { avgMs: avg, fps: 1000 / avg };
    });
    console.log('No Bloom Telemetry:', noBloomTelemetry);

    // Test with Shadow autoUpdate = false
    console.log('\nTesting with Shadow autoUpdate = false...');
    const noShadowUpdateTelemetry = await page.evaluate(async () => {
      const r = window.__fantasticCtx.renderer;
      r.shadowMap.autoUpdate = false;
      r.shadowMap.needsUpdate = true;
      await new Promise(r => setTimeout(r, 500));
      const times = [];
      for (let i = 0; i < 60; i++) {
        const t0 = performance.now();
        await new Promise(r => requestAnimationFrame(r));
        times.push(performance.now() - t0);
      }
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      return { avgMs: avg, fps: 1000 / avg };
    });
    console.log('Static Shadow Telemetry:', noShadowUpdateTelemetry);

    // Test both optimizations combined
    console.log('\nTesting both optimizations combined (Static Shadow + Direct Render)...');
    const combinedTelemetry = await page.evaluate(async () => {
      window.__artisanDisableBloom = true;
      const r = window.__fantasticCtx.renderer;
      r.shadowMap.autoUpdate = false;
      await new Promise(r => setTimeout(r, 500));
      const times = [];
      for (let i = 0; i < 60; i++) {
        const t0 = performance.now();
        await new Promise(r => requestAnimationFrame(r));
        times.push(performance.now() - t0);
      }
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      return { avgMs: avg, fps: 1000 / avg };
    });
    console.log('Combined Optimization Telemetry:', combinedTelemetry);

  } catch (err) {
    console.error('Diagnosis error:', err);
  } finally {
    await browser.close();
  }
}

diagnose();
