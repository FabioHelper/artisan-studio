import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function diagnoseSouth() {
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

  // Turn south
  await page.evaluate(() => {
    window.__fantasticCtx.yaw = 0;
  });
  await new Promise(r => setTimeout(r, 500));

  async function sampleFPS() {
    return page.evaluate(async () => {
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
      return { fps: (1000 / avg).toFixed(1), avgMs: avg.toFixed(2), minMs: Math.min(...times).toFixed(2), maxMs: Math.max(...times).toFixed(2) };
    });
  }

  const baseline = await sampleFPS();
  console.log('1. South Hall Baseline:', baseline);

  // Check what objects are in view and their draw calls / triangles
  const renderInfo = await page.evaluate(() => {
    const r = window.__fantasticCtx.renderer;
    return {
      calls: r.info.render.calls,
      triangles: r.info.render.triangles,
      geometries: r.info.memory.geometries,
      textures: r.info.memory.textures
    };
  });
  console.log('Render Info in South Hall:', renderInfo);

  // Test A: Disable Bloom in South Hall
  await page.evaluate(() => { window.__artisanDisableBloom = true; });
  const noBloom = await sampleFPS();
  console.log('2. South Hall without Bloom:', noBloom);

  // Test B: Without particle system
  await page.evaluate(() => {
    window.__fantasticCtx.scene.traverse(obj => {
      if (obj.isPoints) obj.visible = false;
    });
  });
  const noParticles = await sampleFPS();
  console.log('3. South Hall without Particles (Points):', noParticles);

  // Test C: Calibrate Chandelier Light
  await page.evaluate(() => {
    window.__artisanDisableBloom = false;
    window.__fantasticCtx.scene.traverse(obj => {
      if (obj.isPoints) obj.visible = true;
      if (obj.isPointLight && obj.intensity > 15) {
        obj.intensity = 8;
        obj.distance = 20;
      }
    });
  });
  const calibrated = await sampleFPS();
  console.log('4. South Hall with Calibrated Light + Bloom:', calibrated);

  await browser.close();
}

diagnoseSouth().catch(console.error);
