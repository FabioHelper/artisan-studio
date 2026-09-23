import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const SCENES = ['trio', 'tavern', 'alchemist', 'armory', 'library', 'tokyo', 'winterhold'];

async function test() {
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
    ],
    defaultViewport: { width: 1280, height: 720 }
  });

  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__artisan && window.__artisan.loadScene, { timeout: 10000 });

  async function measureScene(sceneId, optimize = false) {
    await page.evaluate((id, opt) => {
      window.__artisan.switchToDioramaMode();
      window.__artisan.loadScene(id);

      if (opt) {
        // 1. Remove redundant child lights from props (keep LightingRig canonical lights)
        window.__artisan.activeWorldGroup.traverse(o => {
          if (o.isLight) o.visible = false;
        });

        // 2. Disable PointLight shadow (save 6 cubemap depth faces)
        window.__artisan.scene.traverse(o => {
          if (o.isPointLight) o.castShadow = false;
        });

        // 3. Remove PMREM if on integrated GPU
        window.__artisan.scene.environment = null;
      }
    }, sceneId, optimize);

    await new Promise(r => setTimeout(r, 1200));

    return await page.evaluate(async () => {
      return new Promise(resolve => {
        let count = 0, last = performance.now(), samples = [];
        function loop(now) {
          if (count > 5) samples.push(now - last);
          last = now;
          count++;
          if (count < 35) requestAnimationFrame(loop);
          else {
            const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
            const r = window.__artisan.renderer;
            let activeLights = 0;
            window.__artisan.scene.traverse(o => { if (o.isLight && o.visible) activeLights++; });
            resolve({
              fps: 1000 / avg,
              frametimeMs: avg,
              calls: r.info.render.calls,
              tris: r.info.render.triangles,
              lights: activeLights
            });
          }
        }
        requestAnimationFrame(loop);
      });
    });
  }

  console.log('========================================================================');
  console.log('UNIFIED LIGHTING & SHADOW CONSOLIDATION BENCHMARK (1280x720)');
  console.log('========================================================================\n');

  for (const s of SCENES) {
    const before = await measureScene(s, false);
    const after = await measureScene(s, true);
    const gain = ((after.fps - before.fps) / before.fps * 100).toFixed(0);
    console.log(`[${s.toUpperCase().padEnd(10)}] Before: ${before.fps.toFixed(1)} FPS (${before.lights} lights) -> After: ${after.fps.toFixed(1)} FPS (${after.lights} lights) | Gain: +${gain}% | Draws: ${after.calls}`);
  }

  // Also test 1080p
  console.log('\n========================================================================');
  console.log('UNIFIED LIGHTING & SHADOW CONSOLIDATION BENCHMARK (1920x1080 @ 0.85x PERF)');
  console.log('========================================================================\n');

  await page.setViewport({ width: 1920, height: 1080 });
  await page.evaluate(() => {
    window.__artisan.applyDPRPreset('perf');
  });

  for (const s of SCENES) {
    const after1080 = await measureScene(s, true);
    console.log(`[${s.toUpperCase().padEnd(10)}] 1080p Perf: ${after1080.fps.toFixed(1)} FPS (${after1080.frametimeMs.toFixed(1)}ms) | Draws: ${after1080.calls} | Tris: ${after1080.tris}`);
  }

  await browser.close();
}

test().catch(console.error);
