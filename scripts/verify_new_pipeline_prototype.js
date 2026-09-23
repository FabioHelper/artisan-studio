import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const SCENES = [
  { id: 'trio', name: 'Blacksmith Forge Pavilion' },
  { id: 'tavern', name: 'Medieval Tudor Tavern Hall' },
  { id: 'alchemist', name: "Alchemist's Laboratory" },
  { id: 'armory', name: 'Dungeon Armory' },
  { id: 'library', name: 'Hermit Library Scriptorium' },
  { id: 'tokyo', name: 'Tokyo Nintendo Office' },
  { id: 'winterhold', name: 'Winterhold Arcanaeum' },
  { id: 'fantastic', name: 'The Fantastic World (Game)' }
];

async function verify() {
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

  console.log('Testing prototype optimizations in live WebGL runtime:');

  for (const screen of [
    { name: 'Screen 1 (Laptop 720p Native)', w: 1280, h: 720, dpr: 1.0 },
    { name: 'Screen 2 (External 1080p Perf 0.85x)', w: 1920, h: 1080, dpr: 0.85 }
  ]) {
    console.log(`\n========================================================================`);
    console.log(`BENCHMARK: ${screen.name} (${screen.w}x${screen.h} @ ${screen.dpr}x DPR)`);
    console.log(`========================================================================`);

    await page.setViewport({ width: screen.w, height: screen.h });

    for (const s of SCENES) {
      if (s.id === 'fantastic') {
        await page.evaluate(dprVal => {
          window.__artisan.switchToGameMode();
          window.__fantasticCtx?.renderer?.setPixelRatio(dprVal);
        }, screen.dpr);
        await page.waitForFunction(() => window.__fantasticWorldActive, { timeout: 10000 });
        await new Promise(r => setTimeout(r, 1200));
        await page.evaluate(() => document.getElementById('veil')?.click());
      } else {
        await page.evaluate((id, dprVal) => {
          window.__artisan.switchToDioramaMode();
          window.__artisan.renderer.setPixelRatio(dprVal);
          window.__artisan.loadScene(id);

          // Apply optimizations:
          // 1. Disable child lights
          window.__artisan.activeWorldGroup.traverse(o => {
            if (o.isLight) o.visible = false;
          });
          // 2. Disable point light shadow
          window.__artisan.scene.traverse(o => {
            if (o.isPointLight) o.castShadow = false;
          });
          // 3. Remove PMREM
          window.__artisan.scene.environment = null;
        }, s.id, screen.dpr);
      }

      await new Promise(r => setTimeout(r, 1200));

      const res = await page.evaluate(async () => {
        return new Promise(resolve => {
          let count = 0, last = performance.now(), samples = [];
          function loop(now) {
            if (count > 5) samples.push(now - last);
            last = now;
            count++;
            if (count < 35) requestAnimationFrame(loop);
            else {
              const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
              const r = window.__fantasticCtx?.renderer || window.__artisan?.renderer;
              const info = r?.info?.render || {};
              resolve({
                fps: 1000 / avg,
                frametimeMs: avg,
                calls: window.__fantasticCtx?.sceneDrawCalls || info.calls || 0,
                tris: window.__fantasticCtx?.sceneTris || info.triangles || 0
              });
            }
          }
          requestAnimationFrame(loop);
        });
      });

      console.log(`[${s.name.padEnd(28)}] FPS: ${res.fps.toFixed(1)} | Frametime: ${res.frametimeMs.toFixed(1)}ms | Calls: ${res.calls} | Tris: ${res.tris}`);
    }
  }

  await browser.close();
}

verify().catch(console.error);
