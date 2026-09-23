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
    await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__artisan && window.__artisan.switchToGameMode, { timeout: 15000 });

    console.log('Switching to Game Mode...');
    await page.evaluate(() => window.__artisan.switchToGameMode());
    await new Promise(r => setTimeout(r, 2000));

    // Profile individual CPU stages and render duration
    const stageProfiling = await page.evaluate(async () => {
      const ctx = window.__fantasticCtx;
      const profiler = window.__artisan.profiler;
      
      // Let's measure each component specifically over 60 frames
      const samples = {
        controls: 0,
        animations: 0,
        render: 0,
        total: 0,
        animCount: ctx.animations.length,
        colliderCount: ctx.colliders.length,
        wallCount: ctx.walls.length,
        lightCount: 0
      };

      ctx.scene.traverse(obj => {
        if (obj.isLight) samples.lightCount++;
      });

      for (let i = 0; i < 60; i++) {
        const tFrameStart = performance.now();
        await new Promise(r => requestAnimationFrame(r));
        const dt = Math.min(ctx.clock.getDelta(), 0.05);
        const t = ctx.clock.elapsedTime;

        // measure animations
        const tAnim0 = performance.now();
        for (const fn of ctx.animations) fn(dt, t);
        samples.animations += performance.now() - tAnim0;

        // measure render
        const tR0 = performance.now();
        ctx.renderer.render(ctx.scene, ctx.camera);
        samples.render += performance.now() - tR0;

        samples.total += performance.now() - tFrameStart;
      }

      samples.controls /= 60;
      samples.animations /= 60;
      samples.render /= 60;
      samples.total /= 60;

      return samples;
    });

    console.log('--- STAGE PROFILING BREAKDOWN ---', stageProfiling);

    // Test effect of removing dynamic point lights (keeping ambient & directional)
    console.log('\n--- Testing without 20+ PointLights ---');
    const noPointLightsTelemetry = await page.evaluate(async () => {
      const ctx = window.__fantasticCtx;
      const disabledLights = [];
      ctx.scene.traverse(obj => {
        if (obj.isPointLight && obj.name !== 'MainMoon') {
          obj.visible = false;
          disabledLights.push(obj);
        }
      });

      const times = [];
      for (let i = 0; i < 60; i++) {
        const t0 = performance.now();
        await new Promise(r => requestAnimationFrame(r));
        times.push(performance.now() - t0);
      }
      const avg = times.reduce((a, b) => a + b, 0) / times.length;

      // Restore
      disabledLights.forEach(l => l.visible = true);
      return { avgMs: avg, fps: 1000 / avg, disabledCount: disabledLights.length };
    });
    console.log('No PointLights Telemetry:', noPointLightsTelemetry);

    // Test effect of DPR 0.75x vs 1.0x
    console.log('\n--- Testing with DPR 0.75x ---');
    const dpr75Telemetry = await page.evaluate(async () => {
      const r = window.__fantasticCtx.renderer;
      r.setPixelRatio(0.75);
      await new Promise(r => setTimeout(r, 500));
      const times = [];
      for (let i = 0; i < 60; i++) {
        const t0 = performance.now();
        await new Promise(r => requestAnimationFrame(r));
        times.push(performance.now() - t0);
      }
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      r.setPixelRatio(1.0);
      return { avgMs: avg, fps: 1000 / avg };
    });
    console.log('DPR 0.75x Telemetry:', dpr75Telemetry);

  } catch (err) {
    console.error('Breakdown error:', err);
  } finally {
    await browser.close();
  }
}

diagnose();
