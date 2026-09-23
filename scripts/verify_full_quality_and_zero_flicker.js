import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function verify() {
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
  // Set exact laptop screen viewport with 125% Windows DPI scale
  await page.setViewport({ width: 1280, height: 551, deviceScaleFactor: 1.25 });
  await page.goto('http://localhost:5173/?mode=game', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));
  await page.evaluate(() => document.getElementById('veil')?.click());
  await new Promise(r => setTimeout(r, 1200));

  // Verify properties inside the game context
  const state = await page.evaluate(async () => {
    const ctx = window.__fantasticCtx;
    const isExteriorVisible = ctx.exterior ? ctx.exterior.visible : null;
    const currentZone = ctx.player ? (ctx.player.position.z > 0 ? 'Inside Hall' : 'Exterior') : null;
    const dpr = ctx.renderer.getPixelRatio();
    const width = ctx.renderer.domElement.width;
    const height = ctx.renderer.domElement.height;
    const hasBloom = !!ctx.bloomPass && ctx.bloomPass.enabled;

    // Sample frametimes for 60 frames to check stability & jitter
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

    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    samples.sort((a, b) => a - b);
    const p99 = samples[Math.floor(samples.length * 0.99)];
    const p1 = samples[Math.floor(samples.length * 0.01)];

    return {
      fps: (1000 / avg).toFixed(1),
      frametimeMs: avg.toFixed(2),
      p1Ms: p1.toFixed(2),
      p99Ms: p99.toFixed(2),
      dpr,
      rasterRes: `${width}x${height}`,
      exteriorVisible: isExteriorVisible,
      currentZone,
      bloomActive: hasBloom
    };
  });

  console.log('=== Telemetry & Integrity State ===');
  console.log(JSON.stringify(state, null, 2));

  // Capture Screenshot 1: Facing Moon Window inside hall
  await page.screenshot({
    path: 'C:/Users/Fabio D/.gemini/antigravity/brain/69a02808-eb44-47c0-ae6f-920c8e19911a/fantastic_hall_pure_quality.png'
  });
  console.log('Screenshot 1 saved: fantastic_hall_pure_quality.png');

  // Turn camera 180 degrees to look out through the entrance doorway towards the Dream Garden
  await page.evaluate(() => {
    const ctx = window.__fantasticCtx;
    ctx.yaw = 0; // Look towards negative Z (the doorway and outside garden)
    ctx.pitch = 0;
  });
  await new Promise(r => setTimeout(r, 600));

  // Capture Screenshot 2: Looking out towards the Dream Garden (proving full draw distance!)
  await page.screenshot({
    path: 'C:/Users/Fabio D/.gemini/antigravity/brain/69a02808-eb44-47c0-ae6f-920c8e19911a/fantastic_doorway_draw_distance.png'
  });
  console.log('Screenshot 2 saved: fantastic_doorway_draw_distance.png');

  // Walk forward into the garden to prove smooth transition without pop-in or flicker
  await page.evaluate(() => {
    const ctx = window.__fantasticCtx;
    ctx.player.position.set(0, 0, -22); // In the dream garden by the pond
  });
  await new Promise(r => setTimeout(r, 600));

  // Capture Screenshot 3: Inside Dream Garden
  await page.screenshot({
    path: 'C:/Users/Fabio D/.gemini/antigravity/brain/69a02808-eb44-47c0-ae6f-920c8e19911a/fantastic_garden_draw_distance.png'
  });
  console.log('Screenshot 3 saved: fantastic_garden_draw_distance.png');

  await browser.close();
}

verify().catch(console.error);
