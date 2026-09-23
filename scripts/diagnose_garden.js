import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function diagnoseGarden() {
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

  // Move player to Dream Garden
  await page.evaluate(() => {
    window.__fantasticCtx.player.position.set(0, 0, -22);
  });
  await new Promise(r => setTimeout(r, 500));

  async function measure(name, testFn) {
    if (testFn) await page.evaluate(testFn);
    await new Promise(r => setTimeout(r, 400));
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
          if (count < 45) requestAnimationFrame(loop);
          else resolve();
        }
        requestAnimationFrame(loop);
      });
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      return { fps: (1000 / avg).toFixed(1), ms: avg.toFixed(2) };
    });
    console.log(`[Garden Profiling] ${name}:`, res);
    return res;
  }

  await measure('1. Baseline Garden (DPR 1.0, Bloom on, Shadows on)');

  // Test A: Disable ShadowMap
  await measure('2. Turn OFF ShadowMap', () => {
    window.__fantasticCtx.renderer.shadowMap.enabled = false;
    window.__fantasticCtx.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  });

  // Re-enable ShadowMap
  await page.evaluate(() => {
    window.__fantasticCtx.renderer.shadowMap.enabled = true;
    window.__fantasticCtx.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  });

  // Test B: Disable Bloom (direct render)
  await measure('3. Turn OFF Bloom (direct renderer.render)', () => {
    window.__testDirectRender = true;
    const oldRender = window.__fantasticCtx.composer.render.bind(window.__fantasticCtx.composer);
    window.__fantasticCtx.composer.render = function() {
      if (window.__testDirectRender) {
        window.__fantasticCtx.renderer.render(window.__fantasticCtx.scene, window.__fantasticCtx.camera);
      } else {
        oldRender();
      }
    };
  });

  // Re-enable Bloom
  await page.evaluate(() => {
    window.__testDirectRender = false;
  });

  // Test C: Test DPR scaling (0.90x, 0.85x, 0.80x, 0.75x)
  await measure('4. DPR 0.90x', () => {
    window.__fantasticCtx.renderer.setPixelRatio(0.90);
    window.__fantasticCtx.composer.setPixelRatio(0.90);
  });

  await measure('5. DPR 0.85x', () => {
    window.__fantasticCtx.renderer.setPixelRatio(0.85);
    window.__fantasticCtx.composer.setPixelRatio(0.85);
  });

  await measure('6. DPR 0.80x', () => {
    window.__fantasticCtx.renderer.setPixelRatio(0.80);
    window.__fantasticCtx.composer.setPixelRatio(0.80);
  });

  await browser.close();
}

diagnoseGarden().catch(console.error);
