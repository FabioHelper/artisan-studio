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

  async function measure(name) {
    return page.evaluate(async (lbl) => {
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
      const r = window.__fantasticCtx?.renderer;
      return {
        test: lbl,
        fps: (1000 / avgDt).toFixed(1),
        frametimeMs: avgDt.toFixed(1),
        dpr: r?.getPixelRatio()
      };
    }, name);
  }

  console.log('1. Raw baseline:', await measure('Baseline 1.25x'));

  // Test A: DPR = 0.80
  await page.evaluate(() => {
    window.__fantasticCtx.renderer.setPixelRatio(0.80);
    window.__fantasticCtx.renderer.setSize(window.innerWidth, window.innerHeight);
    window.__fantasticCtx.composer?.setPixelRatio(0.80);
    window.__fantasticCtx.composer?.setSize(window.innerWidth, window.innerHeight);
  });
  await new Promise(r => setTimeout(r, 800));
  console.log('2. With DPR 0.80x:', await measure('DPR 0.80x'));

  // Test B: DPR = 0.75
  await page.evaluate(() => {
    window.__fantasticCtx.renderer.setPixelRatio(0.75);
    window.__fantasticCtx.renderer.setSize(window.innerWidth, window.innerHeight);
    window.__fantasticCtx.composer?.setPixelRatio(0.75);
    window.__fantasticCtx.composer?.setSize(window.innerWidth, window.innerHeight);
  });
  await new Promise(r => setTimeout(r, 800));
  console.log('3. With DPR 0.75x:', await measure('DPR 0.75x'));

  // Test C: DPR 0.80 + Cull exterior lights + 1024 shadow map
  await page.evaluate(() => {
    // 1. Cull exterior lights
    window.__fantasticCtx.scene.traverse(o => {
      if (o.isPointLight && (o.position.z > 15 || o.position.z < -40)) {
        o.visible = false;
      }
    });
    // 2. Reduce shadow map to 1024
    window.__fantasticCtx.scene.traverse(o => {
      if (o.isDirectionalLight && o.shadow) {
        o.shadow.mapSize.set(1024, 1024);
        o.shadow.map?.dispose();
        o.shadow.map = null;
      }
    });
    window.__fantasticCtx.renderer.shadowMap.needsUpdate = true;
  });
  await new Promise(r => setTimeout(r, 800));
  console.log('4. With DPR 0.80 + Lights Culled + 1024 Shadow:', await measure('Optimized DPR 0.80'));

  // Test D: DPR 0.85 with above optimizations
  await page.evaluate(() => {
    window.__fantasticCtx.renderer.setPixelRatio(0.85);
    window.__fantasticCtx.renderer.setSize(window.innerWidth, window.innerHeight);
    window.__fantasticCtx.composer?.setPixelRatio(0.85);
    window.__fantasticCtx.composer?.setSize(window.innerWidth, window.innerHeight);
  });
  await new Promise(r => setTimeout(r, 800));
  console.log('5. With DPR 0.85 + Lights Culled + 1024 Shadow:', await measure('Optimized DPR 0.85'));

  await browser.close();
}

run().catch(console.error);
