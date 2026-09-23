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
  await new Promise(r => setTimeout(r, 2500));

  // Dismiss veil
  await page.evaluate(() => {
    const v = document.getElementById('veil');
    if (v) v.click();
  });
  await new Promise(r => setTimeout(r, 1500));

  async function benchmark(label) {
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
        label: lbl,
        fps: (1000 / avgDt).toFixed(1),
        ms: avgDt.toFixed(1),
        dpr: r?.getPixelRatio(),
        w: r?.domElement?.width,
        h: r?.domElement?.height
      };
    }, label);
  }

  // 1. Current default (with Composer bloom)
  console.log('1. Current:', await benchmark('Current default'));

  // 2. Direct render (bypassing composer)
  await page.evaluate(() => {
    window.__artisanDisableBloom = true;
  });
  await new Promise(r => setTimeout(r, 1000));
  console.log('2. Direct forward render (no bloom pass):', await benchmark('No bloom pass'));

  // 3. Direct render with DPR 0.85
  await page.evaluate(() => {
    window.__fantasticCtx.renderer.setPixelRatio(0.85);
    window.__fantasticCtx.renderer.setSize(window.innerWidth, window.innerHeight);
  });
  await new Promise(r => setTimeout(r, 1000));
  console.log('3. Direct render + DPR 0.85:', await benchmark('Direct + DPR 0.85'));

  // 4. Test with lights culling (disable exterior lights when inside)
  await page.evaluate(() => {
    // In props.js and exterior.js, there are exterior lights:
    // portalLight, 4 exterior lamp lights
    let count = 0;
    window.__fantasticCtx.scene.traverse(o => {
      if (o.isPointLight && o.position.z > 15) { // exterior lights
        o.visible = false;
        count++;
      }
    });
    console.log(`Culled ${count} exterior lights`);
  });
  await new Promise(r => setTimeout(r, 1000));
  console.log('4. Direct + DPR 0.85 + Exterior lights culled:', await benchmark('Culled lights'));

  await browser.close();
}

run().catch(console.error);
