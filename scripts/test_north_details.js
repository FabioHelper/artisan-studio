import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function testNorthDetails() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-webgl', '--ignore-gpu-blocklist']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1.25 });
  await page.goto('http://localhost:5173/?mode=game', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise(r => setTimeout(r, 2000));
  await page.evaluate(() => document.getElementById('veil')?.click());
  await new Promise(r => setTimeout(r, 1000));

  // Face North (yaw = 0)
  await page.evaluate(() => { window.__fantasticCtx.yaw = 0; });
  await new Promise(r => setTimeout(r, 500));

  async function sampleFPS(label) {
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
          if (count < 65) requestAnimationFrame(loop);
          else resolve();
        }
        requestAnimationFrame(loop);
      });
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      return { fps: (1000 / avg).toFixed(1), avgMs: avg.toFixed(2) };
    });
    console.log(`${label}: FPS = ${res.fps}, ${res.avgMs} ms`);
    return res;
  }

  // 1. Without transmission
  await page.evaluate(() => {
    window.__fantasticCtx.scene.traverse(obj => {
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(m => { if (m.transmission > 0) m.transmission = 0; });
      }
    });
  });
  await sampleFPS('1. Zero Transmission');

  // 2. Hide doorGlow sprite
  await page.evaluate(() => {
    window.__fantasticCtx.scene.traverse(obj => {
      if (obj.isSprite && obj.scale.x < 10) obj.visible = false;
    });
  });
  await sampleFPS('2. Without Door Glow Sprite');

  // 3. Test with DPR 0.85 (Quality Perf preset target) vs 1.0
  await page.evaluate(() => {
    window.__fantasticCtx.renderer.setPixelRatio(0.85);
    window.__fantasticCtx.composer?.setPixelRatio(0.85);
  });
  await sampleFPS('3. With DPR 0.85');

  // 4. Test with DPR 1.0 (Native)
  await page.evaluate(() => {
    window.__fantasticCtx.renderer.setPixelRatio(1.0);
    window.__fantasticCtx.composer?.setPixelRatio(1.0);
  });
  await sampleFPS('4. With DPR 1.0');

  await browser.close();
}

testNorthDetails().catch(console.error);
