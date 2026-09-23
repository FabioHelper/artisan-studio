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

  await page.evaluate(() => {
    const ctx = window.__fantasticCtx;
    ctx.renderer.setPixelRatio(0.75);
    ctx.renderer.setSize(window.innerWidth, window.innerHeight);

    // Disable bloom pass
    window.__artisanDisableBloom = true;

    // Throttle flicker
    ctx.animations.length = 0;
    let lastFlicker = 0;
    ctx.animations.push((dt, t) => {
      if (t - lastFlicker < 0.04) return;
      lastFlicker = t;
      for (const c of ctx.candleLights) {
        const a = c.ampl ?? 0.18;
        const f = 1 + Math.sin(t * 9 + c.seed) * a * 0.5;
        c.light.intensity = c.base * f;
      }
    });

    // Zone culling
    const ext = ctx.scene.getObjectByName('Exterior_Terrain_Pond_Stairs');
    if (ext) ext.visible = false;
  });

  await new Promise(r => setTimeout(r, 1200));

  const res = await page.evaluate(async () => {
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
      fps: (1000 / avgDt).toFixed(1),
      frametime: avgDt.toFixed(2),
      dpr: window.__fantasticCtx?.renderer?.getPixelRatio()
    };
  });

  console.log('=== RESULT WITHOUT BLOOM PASS + 0.75 DPR ===');
  console.log(JSON.stringify(res, null, 2));

  await browser.close();
}

run().catch(console.error);
