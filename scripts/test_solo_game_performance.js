import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function testSolo() {
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
    ]
  });

  const page = await browser.newPage();
  // Exact user laptop screen: 1280x551 with 125% Windows display scaling
  await page.setViewport({ width: 1280, height: 551, deviceScaleFactor: 1.25 });
  await page.goto('http://localhost:5173/?mode=game', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));
  await page.evaluate(() => document.getElementById('veil')?.click());
  await new Promise(r => setTimeout(r, 1500));

  // Check exclusivity state
  const isolationCheck = await page.evaluate(() => {
    return {
      singleInstanceMode: window.__singleInstanceGuard?.getStatus?.(),
      dioramaActiveGroup: !!window.__artisan?.activeWorldGroup?.parent,
      dioramaSceneChildrenCount: window.__artisan?.scene?.children?.length,
      fantasticSceneChildrenCount: window.__fantasticCtx?.scene?.children?.length,
      isFantasticWorldActive: window.__fantasticWorldActive,
      fantasticFps: window.__fantasticCtx?.gameFps || 'N/A'
    };
  });
  console.log('Isolation Check:', JSON.stringify(isolationCheck, null, 2));

  // Benchmark Framerate
  async function sampleFPS(label) {
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
          if (count < 65) requestAnimationFrame(loop);
          else resolve();
        }
        requestAnimationFrame(loop);
      });
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      times.sort((a, b) => a - b);
      return {
        fps: (1000 / avg).toFixed(1),
        frametimeMs: avg.toFixed(2),
        p99Ms: times[Math.floor(times.length * 0.99)].toFixed(2),
        dpr: window.__fantasticCtx.renderer.getPixelRatio()
      };
    });
    console.log(`[FPS Benchmark] ${label}:`, res);
    return res;
  }

  await sampleFPS('Auto 60 Preset (Solo Boot)');

  // Switch to PERF preset via F2 or toggle
  await page.evaluate(() => {
    window.__artisan.applyDPRPreset?.('perf') || window.__artisan.toggleDPR?.();
  });
  await new Promise(r => setTimeout(r, 1000));
  await sampleFPS('Perf Preset (Solo)');

  // Take screenshot
  await page.screenshot({
    path: 'C:/Users/Fabio D/.gemini/antigravity/brain/69a02808-eb44-47c0-ae6f-920c8e19911a/solo_game_verified.png'
  });
  console.log('Saved screenshot: solo_game_verified.png');

  await browser.close();
}

testSolo().catch(console.error);
