import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function testMergedLights() {
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

  async function benchmarkFPS() {
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

  console.log('Current FPS with 18 lights:');
  const b1 = await benchmarkFPS();
  console.log('Baseline:', b1);

  // Turn off duplicate hallGlow in lighting.js (keep chandLight)
  const afterHallGlow = await page.evaluate(() => {
    let found = false;
    window.__fantasticCtx?.scene?.traverse(obj => {
      if (obj.isPointLight && obj.position.y > 10 && obj.distance >= 25) {
        obj.intensity = 0;
        obj.visible = false;
        found = true;
      }
    });
    return found;
  });
  console.log('Removed duplicate central hallGlow:', afterHallGlow);

  const b2 = await benchmarkFPS();
  console.log('After removing duplicate hallGlow:', b2);

  // Turn off 2 of the 4 exterior lantern point lights (bulbs still glow!)
  await page.evaluate(() => {
    let count = 0;
    window.__fantasticCtx?.candleLights?.forEach(c => {
      // exterior lanterns have base 20
      if (c.base === 20) {
        count++;
        if (count % 2 === 0 && c.light) {
          c.light.intensity = 0;
          c.light.visible = false;
        }
      }
    });
  });

  const b3 = await benchmarkFPS();
  console.log('After consolidating exterior lanterns:', b3);

  await browser.close();
}

testMergedLights().catch(console.error);
