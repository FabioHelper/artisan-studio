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
  await page.setViewport({ width: 1280, height: 551, deviceScaleFactor: 1.25 });
  await page.goto('http://localhost:5173/?mode=game', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));
  await page.evaluate(() => document.getElementById('veil')?.click());
  await new Promise(r => setTimeout(r, 1000));

  async function benchmark(desc) {
    const res = await page.evaluate(async () => {
      const times = [];
      let last = performance.now();
      await new Promise(resolve => {
        let frames = 0;
        function step(t) {
          const dt = t - last;
          last = t;
          if (frames > 10) times.push(dt);
          frames++;
          if (frames < 70) requestAnimationFrame(step);
          else resolve();
        }
        requestAnimationFrame(step);
      });
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      times.sort((a, b) => a - b);
      const p99 = times[Math.floor(times.length * 0.99)];
      return {
        fps: (1000 / avg).toFixed(1),
        frametimeMs: avg.toFixed(2),
        p99Ms: p99.toFixed(2),
        dpr: window.__fantasticCtx.renderer.getPixelRatio(),
        calls: window.__fantasticCtx.renderer.info.render.calls,
        tris: window.__fantasticCtx.renderer.info.render.triangles
      };
    });
    console.log(desc, res);
    return res;
  }

  console.log('--- Benchmarking Current State ---');
  await benchmark('Current State (with culling and 0.75):');

  console.log('--- Test A: Exterior VISIBLE (full draw distance restored) ---');
  await page.evaluate(() => {
    if (window.__fantasticCtx.exterior) window.__fantasticCtx.exterior.visible = true;
  });
  await benchmark('Exterior Always Visible:');

  console.log('--- Test B: DPR 1.0 (Full Native Resolution) + Bloom On ---');
  await page.evaluate(() => {
    window.__artisanDisableBloom = false;
    window.__fantasticCtx.renderer.setPixelRatio(1.0);
    window.__fantasticCtx.composer.setPixelRatio(1.0);
    window.__fantasticCtx.composer.setSize(window.innerWidth, window.innerHeight);
  });
  await benchmark('DPR 1.0 Native + Full Bloom:');

  console.log('--- Test C: Check What is Eating Time in DPR 1.0 ---');
  // Check shadowMap cost
  await page.evaluate(() => {
    window.__fantasticCtx.renderer.shadowMap.autoUpdate = false;
  });
  await benchmark('DPR 1.0 with ShadowMap autoUpdate=false (cached):');

  await browser.close();
}

run().catch(console.error);
