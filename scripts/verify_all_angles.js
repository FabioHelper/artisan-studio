import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function verifyAllAngles() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-webgl', '--ignore-gpu-blocklist']
  });

  const page = await browser.newPage();
  // Laptop resolution with 125% scaling
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1.25 });
  await page.goto('http://localhost:5173/?mode=game', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise(r => setTimeout(r, 2000));
  await page.evaluate(() => document.getElementById('veil')?.click());
  await new Promise(r => setTimeout(r, 1500));

  async function sampleFPS() {
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

  // 1. Great Hall North Arch (Circular Moon Window)
  const fpsNorth = await sampleFPS();
  console.log('1. North Arch / Moon Window:', fpsNorth);
  await page.screenshot({ path: 'scripts/view_north_window.png' });

  // 2. Turn around to face South (Chandelier, Desk, Sconces, Fireplace)
  await page.evaluate(() => {
    window.__fantasticCtx.yaw = 0; // Face south into the hall
  });
  await new Promise(r => setTimeout(r, 500));
  const fpsSouth = await sampleFPS();
  console.log('2. South Hall (Chandelier, Desk, Fireplace):', fpsSouth);
  await page.screenshot({ path: 'scripts/view_south_hall.png' });

  // 3. Walk out to the Dream Garden
  await page.evaluate(() => {
    window.__fantasticCtx.player.position.set(0, 0, -22); // Out in the garden
    window.__fantasticCtx.yaw = Math.PI; // Face north towards portal and mountains
  });
  await new Promise(r => setTimeout(r, 500));
  const fpsGarden = await sampleFPS();
  console.log('3. Dream Garden (Mountains, Pines, Sky, Portal):', fpsGarden);
  await page.screenshot({ path: 'scripts/view_dream_garden.png' });

  // 4. Test 1440p Monitor Viewport (2560x1440)
  console.log('=== TEST 4: High-Res 1440p Screen (2560x1440) ===');
  await page.setViewport({ width: 2560, height: 1440, deviceScaleFactor: 1.0 });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await new Promise(r => setTimeout(r, 1000));
  const fps1440p = await sampleFPS();
  const dpr1440p = await page.evaluate(() => window.__fantasticCtx.renderer.getPixelRatio());
  console.log(`4. 1440p Monitor: FPS = ${fps1440p.fps} (${fps1440p.avgMs}ms), DPR = ${dpr1440p}`);
  await page.screenshot({ path: 'scripts/view_1440p_screen.png' });

  await browser.close();
}

verifyAllAngles().catch(console.error);
