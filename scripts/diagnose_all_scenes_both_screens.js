import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

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

const SCREENS = [
  { name: 'Screen 1 (Laptop DISPLAY1)', width: 1280, height: 720 },
  { name: 'Screen 2 (External DISPLAY2)', width: 1920, height: 1080 }
];

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

  const allResults = [];

  for (const screen of SCREENS) {
    console.log(`\n================================================================`);
    console.log(`TESTING ON ${screen.name} (${screen.width}x${screen.height})`);
    console.log(`================================================================`);

    const page = await browser.newPage();
    await page.setViewport({ width: screen.width, height: screen.height });
    await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForFunction(() => window.__artisan && window.__artisan.loadScene, { timeout: 10000 });

    for (const s of SCENES) {
      // Switch to scene
      if (s.id === 'fantastic') {
        await page.evaluate(() => window.__artisan.switchToGameMode?.());
        await page.waitForFunction(() => window.__fantasticWorldActive, { timeout: 10000 });
        await new Promise(r => setTimeout(r, 1000));
        await page.evaluate(() => {
          const v = document.getElementById('veil');
          if (v) v.click();
        });
      } else {
        await page.evaluate(id => {
          window.__artisan.switchToDioramaMode?.();
          window.__artisan.loadScene(id);
        }, s.id);
      }

      // Warmup frames
      await new Promise(r => setTimeout(r, 1200));

      // Test with AUTO (or PERF 0.85x)
      const data = await page.evaluate(async () => {
        return new Promise(resolve => {
          const samples = [];
          const renderTimes = [];
          let count = 0;
          let last = performance.now();

          function sample(t) {
            const dt = t - last;
            last = t;
            if (count > 5) { // Skip first 5 warmup frames
              samples.push(dt);
              const r = window.__artisan?.renderer;
              renderTimes.push(window.__artisan?.profiler?.stageMetrics?.ForwardRender?.lastMs || 0);
            }
            count++;
            if (count < 65) {
              requestAnimationFrame(sample);
            } else {
              const avgDt = samples.reduce((a, b) => a + b, 0) / samples.length;
              const sorted = [...samples].sort((a, b) => a - b);
              const p99Dt = sorted[Math.floor(sorted.length * 0.95)];
              const avgRenderMs = renderTimes.reduce((a, b) => a + b, 0) / renderTimes.length;
              const r = (window.__fantasticCtx?.renderer || window.__artisan?.renderer);
              const info = r?.info?.render || {};
              resolve({
                avgFps: 1000 / avgDt,
                avgDt,
                p99Dt,
                lowFps: 1000 / p99Dt,
                avgRenderMs,
                drawCalls: window.__fantasticCtx?.sceneDrawCalls || info.calls || 0,
                triangles: window.__fantasticCtx?.sceneTris || info.triangles || 0,
                dpr: r?.getPixelRatio() || 1
              });
            }
          }
          requestAnimationFrame(sample);
        });
      });

      console.log(`[${s.name}] FPS: ${data.avgFps.toFixed(1)} | Frametime: ${data.avgDt.toFixed(1)}ms (p99: ${data.p99Dt.toFixed(1)}ms) | GPU Render: ${data.avgRenderMs.toFixed(2)}ms | Calls: ${data.drawCalls} | Tris: ${data.triangles} | DPR: ${data.dpr}x`);

      allResults.push({
        screen: screen.name,
        res: `${screen.width}x${screen.height}`,
        sceneId: s.id,
        sceneName: s.name,
        ...data
      });
    }

    await page.close();
  }

  await browser.close();

  fs.writeFileSync(
    'C:\\Users\\Fabio D\\.gemini\\antigravity\\brain\\69a02808-eb44-47c0-ae6f-920c8e19911a\\all_scenes_both_screens_benchmark.json',
    JSON.stringify(allResults, null, 2)
  );
  console.log('\nResults saved to all_scenes_both_screens_benchmark.json');
}

run().catch(console.error);
