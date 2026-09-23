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
  await page.goto('http://localhost:5173/?mode=game', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForFunction(() => window.__fantasticWorldActive, { timeout: 10000 });
  await page.evaluate(() => document.getElementById('veil')?.click());
  await new Promise(r => setTimeout(r, 2000));

  async function measureFps(label) {
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
          if (count < 55) requestAnimationFrame(loop);
          else resolve();
        }
        requestAnimationFrame(loop);
      });
      const avgDt = samples.reduce((a, b) => a + b, 0) / samples.length;
      return { label: lbl, fps: 1000 / avgDt, dt: avgDt };
    }, label);
  }

  // 1. Baseline
  console.log('1. Baseline:', await measureFps('Baseline (Full game)'));

  // 2. Disable Bloom
  await page.evaluate(() => {
    window.__artisanDisableBloom = true;
  });
  await new Promise(r => setTimeout(r, 500));
  console.log('2. Without Bloom:', await measureFps('Without Bloom'));

  // 3. Disable shadow map
  await page.evaluate(() => {
    window.__fantasticCtx.renderer.shadowMap.enabled = false;
    window.__fantasticCtx.scene.traverse(o => {
      if (o.material) o.material.needsUpdate = true;
    });
  });
  await new Promise(r => setTimeout(r, 1000));
  console.log('3. Without ShadowMap:', await measureFps('Without ShadowMap'));

  // 4. Test with only 3 lights (ambient + sun + hall glow)
  await page.evaluate(() => {
    const lights = [];
    window.__fantasticCtx.scene.traverse(o => {
      if (o.isLight) lights.push(o);
    });
    // disable all except first 4
    for (let i = 4; i < lights.length; i++) {
      lights[i].visible = false;
    }
  });
  await new Promise(r => setTimeout(r, 1000));
  console.log('4. With 4 Lights:', await measureFps('With 4 Lights'));

  // 5. Test DPR = 0.85
  await page.evaluate(() => {
    window.__fantasticCtx.renderer.setPixelRatio(0.85);
    window.__fantasticCtx.renderer.setSize(window.innerWidth, window.innerHeight);
  });
  await new Promise(r => setTimeout(r, 500));
  console.log('5. With DPR 0.85 + 4 Lights:', await measureFps('DPR 0.85 + 4 Lights'));

  await browser.close();
}

run().catch(console.error);
