import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function testShadow() {
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

  // Benchmark baseline
  const b1 = await page.evaluate(async () => {
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
  console.log('Baseline with autoUpdate = true:', b1);

  // Set autoUpdate = false (shadow map already baked!)
  await page.evaluate(() => {
    const r = window.__fantasticCtx.renderer;
    r.shadowMap.autoUpdate = false;
    r.shadowMap.needsUpdate = false;
  });

  const b2 = await page.evaluate(async () => {
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
  console.log('With shadowMap static bake (autoUpdate = false):', b2);

  // Take screenshot to verify shadows exist and are gorgeous
  await page.screenshot({ path: 'scripts/shadow_bake_verified.png' });
  console.log('Saved screenshot scripts/shadow_bake_verified.png');

  await browser.close();
}

testShadow().catch(console.error);
