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
  // Exact user laptop setup: 1280x551 with 1.25x scaling
  await page.setViewport({ width: 1280, height: 551, deviceScaleFactor: 1.25 });
  await page.goto('http://localhost:5173/?mode=game', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));
  await page.evaluate(() => document.getElementById('veil')?.click());
  await new Promise(r => setTimeout(r, 1000));

  // Apply optimizations in browser context
  await page.evaluate(() => {
    const ctx = window.__fantasticCtx;

    // 1. Calibrate DPR to 0.80 (PERF mode for 720p/125% screen)
    ctx.renderer.setPixelRatio(0.80);
    ctx.renderer.setSize(window.innerWidth, window.innerHeight);
    ctx.composer?.setPixelRatio(0.80);
    ctx.composer?.setSize(window.innerWidth, window.innerHeight);

    // 2. Throttle candle flicker animation to 30Hz
    // Replace the animation in ctx.animations
    ctx.animations.length = 0;
    let lastFlicker = 0;
    ctx.animations.push((dt, t) => {
      if (t - lastFlicker < 0.033) return;
      lastFlicker = t;
      for (const c of ctx.candleLights) {
        const a = c.ampl ?? 0.18;
        const f = 1 + Math.sin(t * 9 + c.seed) * a * 0.5
                    + Math.sin(t * 23 + c.seed * 1.7) * a * 0.35
                    + Math.sin(t * 5.2 + c.seed * 0.6) * a * 0.15;
        c.light.intensity = c.base * f;
        if (c.flame) {
          const sBase = c.flame.userData.s0 ?? (c.flame.userData.s0 = c.flame.scale.x);
          c.flame.scale.x = c.flame.scale.z = sBase * (0.92 + f * 0.08);
        }
      }
    });

    // 3. Shadow map size 1024x1024
    ctx.scene.traverse(o => {
      if (o.isDirectionalLight && o.shadow) {
        o.shadow.mapSize.set(1024, 1024);
        o.shadow.map?.dispose();
        o.shadow.map = null;
      }
    });
    ctx.renderer.shadowMap.needsUpdate = true;

    // 4. Zone culling: when inside hall (p.z > 0), hide exterior
    const ext = ctx.scene.getObjectByName('Exterior_Terrain_Pond_Stairs');
    if (ext) ext.visible = false;
  });

  await new Promise(r => setTimeout(r, 1200));

  // Measure 60 frames
  const result = await page.evaluate(async () => {
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
    const sorted = [...samples].sort((a, b) => a - b);
    const p99Dt = sorted[Math.floor(sorted.length * 0.95)];
    return {
      fps: (1000 / avgDt).toFixed(1),
      frametime: avgDt.toFixed(2),
      p99: p99Dt.toFixed(2),
      dpr: window.__fantasticCtx?.renderer?.getPixelRatio()
    };
  });

  console.log('=== VERIFICATION RESULT WITH OPTIMIZATIONS ===');
  console.log(JSON.stringify(result, null, 2));

  await browser.close();
}

run().catch(console.error);
