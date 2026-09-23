import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function run() {
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
    ]
  });

  const page = await browser.newPage();
  // Exact user resolution and devicePixelRatio
  await page.setViewport({ width: 1280, height: 551, deviceScaleFactor: 1.25 });
  await page.goto('http://localhost:5173/?mode=game', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForFunction(() => window.__fantasticWorldActive, { timeout: 10000 });

  // Click veil to enter game
  await page.evaluate(() => {
    const v = document.getElementById('veil');
    if (v) v.click();
  });

  await new Promise(r => setTimeout(r, 2000));

  // Diagnose state
  const state = await page.evaluate(async () => {
    const ctx = window.__fantasticCtx;
    const artisan = window.__artisan;
    const r = ctx?.renderer;

    // Sample 60 frames
    const samples = [];
    const forwardRenderTimes = [];
    let last = performance.now();

    await new Promise(resolve => {
      let count = 0;
      function loop(t) {
        const dt = t - last;
        last = t;
        if (count > 5) {
          samples.push(dt);
          forwardRenderTimes.push(artisan?.profiler?.stageMetrics?.ForwardRender?.lastMs || 0);
        }
        count++;
        if (count < 65) requestAnimationFrame(loop);
        else resolve();
      }
      requestAnimationFrame(loop);
    });

    const avgDt = samples.reduce((a, b) => a + b, 0) / samples.length;
    const avgForwardMs = forwardRenderTimes.reduce((a, b) => a + b, 0) / forwardRenderTimes.length;

    // List all lights in scene
    const lights = [];
    ctx?.scene?.traverse(o => {
      if (o.isLight) {
        lights.push({
          type: o.type,
          name: o.name,
          castShadow: o.castShadow,
          intensity: o.intensity,
          color: o.color?.getHexString(),
          distance: o.distance
        });
      }
    });

    // Check composer passes
    const passes = ctx?.composer?.passes?.map(p => ({
      name: p.constructor?.name,
      enabled: p.enabled
    })) || [];

    // Check shadowMap settings
    const shadowMap = {
      enabled: r?.shadowMap?.enabled,
      autoUpdate: r?.shadowMap?.autoUpdate,
      type: r?.shadowMap?.type
    };

    return {
      dpr: r?.getPixelRatio(),
      pixelWidth: r?.domElement?.width,
      pixelHeight: r?.domElement?.height,
      avgFps: 1000 / avgDt,
      avgDt,
      avgForwardMs,
      calls: r?.info?.render?.calls,
      triangles: r?.info?.render?.triangles,
      lightsCount: lights.length,
      lights,
      passes,
      shadowMap,
      currentDprPreset: artisan?.getDPRPreset?.()
    };
  });

  console.log('=== USER EXACT STATE DIAGNOSTIC ===');
  console.log(JSON.stringify(state, null, 2));

  // Now click toggleDPR to PERF 0.85x
  console.log('\n--- Switching to PERF via toggleDPR ---');
  await page.evaluate(() => {
    window.__artisan?.cycleQuality?.();
  });
  await new Promise(r => setTimeout(r, 1500));

  const statePerf = await page.evaluate(async () => {
    const ctx = window.__fantasticCtx;
    const artisan = window.__artisan;
    const r = ctx?.renderer;

    const samples = [];
    let last = performance.now();

    await new Promise(resolve => {
      let count = 0;
      function loop(t) {
        const dt = t - last;
        last = t;
        if (count > 5) samples.push(dt);
        count++;
        if (count < 65) requestAnimationFrame(loop);
        else resolve();
      }
      requestAnimationFrame(loop);
    });

    const avgDt = samples.reduce((a, b) => a + b, 0) / samples.length;
    return {
      dprPreset: artisan?.getDPRPreset?.(),
      dpr: r?.getPixelRatio(),
      pixelWidth: r?.domElement?.width,
      pixelHeight: r?.domElement?.height,
      avgFps: 1000 / avgDt,
      avgDt,
      calls: r?.info?.render?.calls
    };
  });

  console.log('=== STATE AFTER PERF SWITCH ===');
  console.log(JSON.stringify(statePerf, null, 2));

  await browser.close();
}

run().catch(console.error);
