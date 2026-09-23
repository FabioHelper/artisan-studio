import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function runAudit() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-webgl', '--ignore-gpu-blocklist']
  });

  const page = await browser.newPage();

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
          if (count < 55) requestAnimationFrame(loop);
          else resolve();
        }
        requestAnimationFrame(loop);
      });
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      return { fps: (1000 / avg).toFixed(1), ms: avg.toFixed(2) };
    });
  }

  console.log('=== TEST 1: Diorama Mode on Laptop Screen (1280x720) ===');
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1.25 });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1500));
  const dioramaLaptop = await benchmarkFPS();
  console.log('Diorama (Laptop Screen):', dioramaLaptop);

  console.log('=== TEST 2: Diorama Mode on High-Res 1440p Monitor (2560x1440) ===');
  await page.setViewport({ width: 2560, height: 1440, deviceScaleFactor: 1.0 });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await new Promise(r => setTimeout(r, 1000));
  const diorama1440p = await benchmarkFPS();
  console.log('Diorama (1440p High-Res Monitor):', diorama1440p);

  console.log('=== TEST 3: Fantastic World Game Mode on Laptop Screen (1280x551) ===');
  await page.setViewport({ width: 1280, height: 551, deviceScaleFactor: 1.25 });
  await page.goto('http://localhost:5173/?mode=game', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2000));
  await page.evaluate(() => document.getElementById('veil')?.click());
  await new Promise(r => setTimeout(r, 1500));

  const gameIsolation = await page.evaluate(() => {
    return {
      appMode: window.__artisan?.getAppMode?.() || 'game',
      dioramaSceneChildren: window.__artisan?.scene?.children?.length,
      singleGuardStatus: window.__singleInstanceGuard?.getStatus?.(),
      dpr: window.__fantasticCtx?.renderer?.getPixelRatio()
    };
  });
  console.log('Game Isolation Status:', gameIsolation);
  const gameLaptop = await benchmarkFPS();
  console.log('Game (Laptop Screen):', gameLaptop);

  await browser.close();
}

runAudit().catch(console.error);
