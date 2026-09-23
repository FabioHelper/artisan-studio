import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function testPasses() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-webgl', '--ignore-gpu-blocklist']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1.25 });
  await page.goto('http://localhost:5173/?mode=game', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));
  await page.evaluate(() => document.getElementById('veil')?.click());
  await new Promise(r => setTimeout(r, 1000));

  const passTimings = await page.evaluate(async () => {
    const ctx = window.__fantasticCtx;
    const composer = ctx.composer;
    const renderer = ctx.renderer;

    // Measure raw scene render time
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) {
      renderer.render(ctx.scene, ctx.camera);
    }
    const rawRenderMs = (performance.now() - t0) / 20;

    // Measure composer render time
    const t1 = performance.now();
    for (let i = 0; i < 20; i++) {
      composer.render();
    }
    const composerRenderMs = (performance.now() - t1) / 20;

    const dpr = renderer.getPixelRatio();
    return {
      rawRenderMs: rawRenderMs.toFixed(2),
      composerRenderMs: composerRenderMs.toFixed(2),
      bloomOverheadMs: (composerRenderMs - rawRenderMs).toFixed(2),
      pixelRatio: dpr,
      size: [window.innerWidth, window.innerHeight]
    };
  });

  console.log('Pass Timings:', passTimings);

  await browser.close();
}

testPasses().catch(console.error);
