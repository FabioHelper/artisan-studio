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

  async function sample(label) {
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
      return { step: lbl, fps: (1000 / avgDt).toFixed(1), ms: avgDt.toFixed(2) };
    }, label);
  }

  console.log('1. Base:', await sample('Base'));

  // Test 1: Disable particles
  await page.evaluate(() => {
    window.__fantasticCtx.scene.traverse(o => {
      if (o.isPoints) o.visible = false;
    });
  });
  console.log('2. Without Particles:', await sample('No particles'));

  // Test 2: Disable animations (candle flicker loop)
  await page.evaluate(() => {
    window.__fantasticCtx.animations.length = 0;
  });
  console.log('3. Without Candle Flicker loop:', await sample('No flicker'));

  // Test 3: Disable shadow map entirely
  await page.evaluate(() => {
    window.__fantasticCtx.renderer.shadowMap.enabled = false;
  });
  console.log('4. Without ShadowMap:', await sample('No ShadowMap'));

  // Test 4: Disable bloom composer (render directly)
  await page.evaluate(() => {
    window.__artisanDisableBloom = true;
  });
  console.log('5. Direct render (no bloom pass):', await sample('No bloom'));

  // Test 5: Hide exterior world meshes
  await page.evaluate(() => {
    window.__fantasticCtx.scene.traverse(o => {
      if (o.position.z < -20 || o.position.z > 20) {
        o.visible = false;
      }
    });
  });
  console.log('6. Interior only (hide exterior):', await sample('Interior only'));

  // Test 6: Set DPR to 0.75
  await page.evaluate(() => {
    window.__fantasticCtx.renderer.setPixelRatio(0.75);
    window.__fantasticCtx.renderer.setSize(window.innerWidth, window.innerHeight);
  });
  console.log('7. DPR 0.75 + all above:', await sample('DPR 0.75 + above'));

  await browser.close();
}

run().catch(console.error);
