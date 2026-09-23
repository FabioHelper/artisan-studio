import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function testCpuVsGpu() {
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
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__artisan && window.__artisan.loadScene, { timeout: 10000 });

  await page.evaluate(() => {
    window.__artisan.switchToDioramaMode();
    window.__artisan.loadScene('trio');
  });
  await new Promise(r => setTimeout(r, 2000));

  const timings = await page.evaluate(async () => {
    return new Promise(resolve => {
      const renderDurations = [];
      const controlsDurations = [];
      const lightingDurations = [];
      const totalFrameIntervals = [];
      let lastTime = performance.now();
      let frames = 0;

      const r = window.__artisan.renderer;
      const s = window.__artisan.scene;
      const c = window.__artisan.camera;
      const ctrl = window.__artisan.controls;

      function measure(now) {
        const frameDt = now - lastTime;
        lastTime = now;

        if (frames > 10) {
          totalFrameIntervals.push(frameDt);
          // Measure individual stages
          const t0 = performance.now();
          ctrl.update();
          const t1 = performance.now();
          controlsDurations.push(t1 - t0);

          const t2 = performance.now();
          r.render(s, c);
          const t3 = performance.now();
          renderDurations.push(t3 - t2);
        }
        frames++;

        if (frames < 50) {
          requestAnimationFrame(measure);
        } else {
          resolve({
            avgFrameDt: totalFrameIntervals.reduce((a,b)=>a+b,0) / totalFrameIntervals.length,
            avgRenderMs: renderDurations.reduce((a,b)=>a+b,0) / renderDurations.length,
            avgControlsMs: controlsDurations.reduce((a,b)=>a+b,0) / controlsDurations.length,
            calls: r.info.render.calls,
            tris: r.info.render.triangles
          });
        }
      }
      requestAnimationFrame(measure);
    });
  });

  console.log('TIMINGS BREAKDOWN:');
  console.log(`- Total rAF Frametime: ${timings.avgFrameDt.toFixed(2)} ms (${(1000/timings.avgFrameDt).toFixed(1)} FPS)`);
  console.log(`- renderer.render() duration: ${timings.avgRenderMs.toFixed(2)} ms`);
  console.log(`- controls.update() duration: ${timings.avgControlsMs.toFixed(2)} ms`);
  console.log(`- Mystery Gap (time spent outside render/controls): ${(timings.avgFrameDt - timings.avgRenderMs - timings.avgControlsMs).toFixed(2)} ms`);

  await browser.close();
}

testCpuVsGpu().catch(console.error);
