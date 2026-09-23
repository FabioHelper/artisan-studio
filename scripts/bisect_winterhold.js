import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function bisectWinterhold() {
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

  await page.evaluate(() => {
    window.__artisan.switchToDioramaMode();
    window.__artisan.loadScene('winterhold');
  });

  await new Promise(r => setTimeout(r, 1500));

  const tests = [
    { name: 'Baseline Winterhold', fn: () => {} },
    {
      name: 'Disable Shadows',
      fn: () => { window.__artisan.renderer.shadowMap.enabled = false; }
    },
    {
      name: 'Shadows ON, Disable PMREM / envMap',
      fn: () => {
        window.__artisan.renderer.shadowMap.enabled = true;
        window.__artisan.scene.environment = null;
      }
    },
    {
      name: 'Disable Both Shadows and PMREM',
      fn: () => {
        window.__artisan.renderer.shadowMap.enabled = false;
        window.__artisan.scene.environment = null;
      }
    },
    {
      name: 'Shadows 512x512 instead of 1024x1024, PMREM ON',
      fn: () => {
        window.__artisan.renderer.shadowMap.enabled = true;
        // Re-add envmap
        const pmrem = new THREE.PMREMGenerator(window.__artisan.renderer);
        // find keyLight
        window.__artisan.scene.traverse(obj => {
          if (obj.isDirectionalLight && obj.castShadow) {
            obj.shadow.mapSize.set(512, 512);
            obj.shadow.map?.dispose();
            obj.shadow.map = null;
          }
        });
        window.__artisan.requestShadowBake(2);
      }
    }
  ];

  for (const t of tests) {
    await page.evaluate(t.fn);
    await new Promise(r => setTimeout(r, 800));

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
              tris: r.info.render.triangles
            });
          }
        }
        requestAnimationFrame(loop);
      });
    });

    console.log(`[${t.name}] FPS: ${res.avgFps.toFixed(1)} | Frametime: ${res.frametimeMs.toFixed(2)}ms | Calls: ${res.calls} | Tris: ${res.tris}`);
  }

  await browser.close();
}

bisectWinterhold().catch(console.error);
