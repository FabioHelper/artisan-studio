import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function testConsolidatedLights() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-webgl', '--ignore-gpu-blocklist']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 551, deviceScaleFactor: 1.25 });
  await page.goto('http://localhost:5173/?mode=game', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2000));
  await page.evaluate(() => document.getElementById('veil')?.click());
  await new Promise(r => setTimeout(r, 1000));

  async function benchmark(desc) {
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
          if (count < 55) requestAnimationFrame(loop);
          else resolve();
        }
        requestAnimationFrame(loop);
      });
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      return { fps: (1000 / avg).toFixed(1), ms: avg.toFixed(2) };
    });
    console.log(desc, res);
    return res;
  }

  await benchmark('1. Base with 29 lights:');

  // Test: Remove the 16 redundant individual candle PointLights (keep flames, hallGlow, hearth, chandelier central light)
  await page.evaluate(() => {
    let removed = 0;
    const toRemove = [];
    window.__fantasticCtx.scene.traverse(o => {
      if (o.isPointLight && o.distance <= 7 && o.intensity <= 10) {
        toRemove.push(o);
      }
    });
    toRemove.forEach(l => {
      l.parent?.remove(l);
      removed++;
    });
    console.log('Removed small point lights:', removed);
  });
  await new Promise(r => setTimeout(r, 800));
  await benchmark('2. After consolidating small candle lights:');

  await browser.close();
}

testConsolidatedLights().catch(console.error);
