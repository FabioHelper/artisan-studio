import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function bisect() {
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
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__artisan && window.__artisan.loadScene);

  // Switch to tokyo
  await page.evaluate(() => {
    window.__artisan.switchToDioramaMode();
    window.__artisan.loadScene('tokyo');
  });

  await new Promise(r => setTimeout(r, 1500));

  // Diagnostic tests:
  const tests = [
    { name: 'Baseline Tokyo', fn: () => {} },
    {
      name: 'Disable Shadows completely',
      fn: () => {
        window.__artisan.renderer.shadowMap.enabled = false;
      }
    },
    {
      name: 'Re-enable Shadows, but disable PMREM / envMap',
      fn: () => {
        window.__artisan.renderer.shadowMap.enabled = true;
        window.__artisan.scene.environment = null;
      }
    },
    {
      name: 'Disable All Lights except KeyLight (no shadows)',
      fn: () => {
        window.__artisan.renderer.shadowMap.enabled = false;
        window.__artisan.scene.environment = null;
      }
    },
    {
      name: 'Hide everything except walls',
      fn: () => {
        window.__artisan.activeWorldGroup.children.forEach((c, i) => {
          if (i > 1) c.visible = false;
        });
      }
    }
  ];

  for (const t of tests) {
    await page.evaluate(t.fn);
    await new Promise(r => setTimeout(r, 600));

    const res = await page.evaluate(async () => {
      return new Promise(resolve => {
        const samples = [];
        let count = 0;
        let last = performance.now();
        function loop(now) {
          const dt = now - last;
          last = now;
          if (count > 5) samples.push(dt);
          count++;
          if (count < 45) {
            requestAnimationFrame(loop);
          } else {
            const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
            const r = window.__artisan.renderer;
            resolve({
              avgFps: 1000 / avg,
              frametimeMs: avg,
              calls: r.info.render.calls,
              tris: r.info.render.triangles,
              shadowBakeFrames: window.__artisan.shadowBakeFrames,
              shadowMapEnabled: r.shadowMap.enabled,
              shadowMapAutoUpdate: r.shadowMap.autoUpdate,
              shadowMapNeedsUpdate: r.shadowMap.needsUpdate
            });
          }
        }
        requestAnimationFrame(loop);
      });
    });

    console.log(`[${t.name}] FPS: ${res.avgFps.toFixed(1)} | Frametime: ${res.frametimeMs.toFixed(2)}ms | Calls: ${res.calls} | Tris: ${res.tris} | Shadows: ${res.shadowMapEnabled} (auto: ${res.shadowMapAutoUpdate}, needsUpdate: ${res.shadowMapNeedsUpdate})`);
  }

  await browser.close();
}

bisect().catch(console.error);
