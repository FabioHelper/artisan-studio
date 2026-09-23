
import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function testSouthPerf() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=d3d11']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  await page.goto('http://localhost:5173/?mode=game', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__fantasticWorldActive, { timeout: 10000 });
  await page.evaluate(() => document.getElementById('veil')?.click());
  await new Promise(r => setTimeout(r, 2000));
  
  // Set yaw = 0 (facing south)
  await page.evaluate(() => {
    const ctx = window.__fantasticCtx;
    if (ctx?.player) {
      ctx.player.position.set(0, 0, 6.5);
      ctx.yaw = 0;
    }
    // Switch to PERF mode
    window.__artisan?.cycleQuality?.(); // from auto to perf
  });
  await new Promise(r => setTimeout(r, 2000));

  const result = await page.evaluate(async () => {
    const samples = [];
    let last = performance.now();
    await new Promise(resolve => {
      let count = 0;
      function loop(t) {
        const dt = t - last;
        last = t;
        if (count > 10) samples.push(dt);
        count++;
        if (count < 70) requestAnimationFrame(loop);
        else resolve();
      }
      requestAnimationFrame(loop);
    });
    const avgDt = samples.reduce((a, b) => a + b, 0) / samples.length;
    const r = window.__fantasticCtx?.renderer;
    return {
      avgFps: 1000 / avgDt,
      avgMs: avgDt,
      dpr: r?.getPixelRatio(),
      preset: window.__artisan?.getDPRPreset?.(),
      disableBloom: window.__artisanDisableBloom
    };
  });
  
  console.log('South Perf Result:', result);
  await browser.close();
}

testSouthPerf().catch(console.error);
