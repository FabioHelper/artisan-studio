import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function testCleanLightBudget() {
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
  await new Promise(r => setTimeout(r, 1500));

  // Configure light budget dynamically in the live page:
  const config = await page.evaluate(() => {
    const ctx = window.__fantasticCtx;
    let disabledLights = 0;

    // 1. Keep central chandelier, desk candle, hearth fire, portal light, 1 exterior path light, moon, shaft
    // Disable redundant sconce point lights and duplicate hallGlow
    ctx.scene.traverse(obj => {
      if (obj.isPointLight) {
        // Check if it's a sconce light (y = 2.6 and x > 5 or x < -5)
        if (Math.abs(obj.position.y - 2.6) < 0.2 && Math.abs(obj.position.x) > 5) {
          obj.visible = false;
          obj.intensity = 0;
          disabledLights++;
        }
        // Check if it's avatar light while in first person
        if (obj.parent?.parent === ctx.avatar && !ctx.thirdPerson) {
          obj.visible = false;
          obj.intensity = 0;
          disabledLights++;
        }
      }
    });

    // Count remaining active lights
    let activeLights = 0;
    ctx.scene.traverse(obj => {
      if (obj.isLight && obj.visible && obj.intensity > 0) activeLights++;
    });

    return { disabledLights, activeLights };
  });

  console.log('Applied Light Budget:', config);

  // Benchmark FPS
  const fpsData = await page.evaluate(async () => {
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

  console.log('FPS with Clean Light Budget:', fpsData);

  // Take screenshot to visually inspect quality
  await page.screenshot({ path: 'scripts/clean_light_quality.png' });
  console.log('Saved scripts/clean_light_quality.png');

  await browser.close();
}

testCleanLightBudget().catch(console.error);
