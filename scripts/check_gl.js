import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function checkGl() {
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

  const initial = await page.evaluate(() => {
    const r = window.__artisan.renderer;
    const gl = r.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown',
      vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : 'unknown',
      geometries: r.info.memory.geometries,
      textures: r.info.memory.textures,
      programs: r.info.programs.length,
      calls: r.info.render.calls,
      triangles: r.info.render.triangles
    };
  });
  console.log('Initial WebGL info:', initial);

  // Measure initial Trio fresh
  let trioFps = await page.evaluate(async () => {
    return new Promise(resolve => {
      let count = 0, last = performance.now(), samples = [];
      function loop(now) {
        if (count > 10) samples.push(now - last);
        last = now;
        count++;
        if (count < 50) requestAnimationFrame(loop);
        else resolve(1000 / (samples.reduce((a, b) => a + b, 0) / samples.length));
      }
      requestAnimationFrame(loop);
    });
  });
  console.log('Fresh Trio FPS:', trioFps.toFixed(1));

  // Now measure Tokyo fresh (on a new page!)
  const page2 = await browser.newPage();
  await page2.setViewport({ width: 1280, height: 720 });
  await page2.goto('http://localhost:5173/?scene=tokyo', { waitUntil: 'networkidle0' });
  await page2.waitForFunction(() => window.__artisan && window.__artisan.loadScene);
  await page2.evaluate(() => window.__artisan.loadScene('tokyo'));
  await new Promise(r => setTimeout(r, 2000));

  let tokyoFreshFps = await page2.evaluate(async () => {
    return new Promise(resolve => {
      let count = 0, last = performance.now(), samples = [];
      function loop(now) {
        if (count > 10) samples.push(now - last);
        last = now;
        count++;
        if (count < 50) requestAnimationFrame(loop);
        else resolve(1000 / (samples.reduce((a, b) => a + b, 0) / samples.length));
      }
      requestAnimationFrame(loop);
    });
  });
  console.log('Fresh Tokyo FPS:', tokyoFreshFps.toFixed(1));

  await browser.close();
}

checkGl().catch(console.error);
