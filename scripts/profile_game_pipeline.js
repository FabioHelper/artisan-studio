import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function testPipeline() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-webgl', '--ignore-gpu-blocklist']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1.25 });
  await page.goto('http://localhost:5173/?mode=game', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));
  await page.evaluate(() => document.getElementById('veil')?.click());
  await new Promise(r => setTimeout(r, 1000));

  async function measureFPS(label) {
    const res = await page.evaluate(async () => {
      const times = [];
      let last = performance.now();
      await new Promise(resolve => {
        let count = 0;
        function loop(t) {
          const dt = t - last;
          last = t;
          if (count > 5) times.push(dt);
          count++;
          if (count < 55) requestAnimationFrame(loop);
          else resolve();
        }
        requestAnimationFrame(loop);
      });
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      return { fps: (1000 / avg).toFixed(1), ms: avg.toFixed(2) };
    });
    console.log(`${label}: FPS = ${res.fps}, frametime = ${res.ms} ms`);
    return res;
  }

  // 1. Check if diorama render loop is executing
  const dioramaRunning = await page.evaluate(() => {
    let dioramaRenderCalls = 0;
    const origRender = window.__artisan?.renderer?.render;
    if (origRender) {
      window.__artisan.renderer.render = function(...args) {
        if (args[0] === window.__artisan.scene) {
          dioramaRenderCalls++;
        }
        return origRender.apply(this, args);
      };
    }
    return new Promise(resolve => {
      setTimeout(() => {
        resolve({ dioramaRenderCalls });
      }, 500);
    });
  });
  console.log('Diorama Loop Concurrent Calls in 500ms:', dioramaRunning);

  // Baseline
  await measureFPS('1. Baseline (Current Game Mode)');

  // Test A: Disable Bloom
  await page.evaluate(() => {
    window.__artisanDisableBloom = true;
  });
  await measureFPS('2. Without Bloom (window.__artisanDisableBloom = true)');

  // Test B: Disable Shadow autoUpdate
  await page.evaluate(() => {
    const ctx = window.__fantasticCtx;
    if (ctx?.renderer?.shadowMap) {
      ctx.renderer.shadowMap.autoUpdate = false;
      ctx.renderer.shadowMap.needsUpdate = false;
    }
  });
  await measureFPS('3. Without Continuous Shadow AutoUpdate');

  // Test C: Consolidate / turn off redundant point lights (keep chandelier center & ambient)
  await page.evaluate(() => {
    const ctx = window.__fantasticCtx;
    let count = 0;
    ctx.candleLights.forEach((c, idx) => {
      // Keep only 1 light for chandelier, 2 for wall sconces, 1 for desk, 1 for hearth
      // Turn off the rest of individual point lights (visual flame meshes remain!)
      if (idx > 4) {
        c.light.intensity = 0;
        c.light.visible = false;
        count++;
      }
    });
    return count;
  });
  await measureFPS('4. With Consolidated Lights (flames still visible, 5 active lights)');

  // Test D: Restore Bloom with optimized lights + shadow caching
  await page.evaluate(() => {
    window.__artisanDisableBloom = false;
  });
  await measureFPS('5. Optimized with Bloom Restored (Full Visuals)');

  await browser.close();
}

testPipeline().catch(console.error);
