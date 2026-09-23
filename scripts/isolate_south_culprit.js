import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function isolateSouth() {
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
  await new Promise(r => setTimeout(r, 1000));

  // Turn south
  await page.evaluate(() => { window.__fantasticCtx.yaw = 0; });
  await new Promise(r => setTimeout(r, 500));

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
      return { fps: (1000 / avg).toFixed(1), avgMs: avg.toFixed(2) };
    });
    console.log(`${label}: FPS = ${res.fps}, ${res.avgMs} ms`);
    return res;
  }

  await sampleFPS('1. South Baseline');

  // Test 1: Turn off shaft Spotlight
  await page.evaluate(() => {
    window.__fantasticCtx.scene.traverse(obj => {
      if (obj.isSpotLight) { obj.visible = false; obj.intensity = 0; }
    });
  });
  await sampleFPS('2. Without SpotLight');

  // Test 2: Turn off all lights except ambient/hemi
  await page.evaluate(() => {
    window.__fantasticCtx.scene.traverse(obj => {
      if (obj.isLight && !obj.isAmbientLight && !obj.isHemisphereLight) {
        obj.visible = false;
        obj.intensity = 0;
      }
    });
  });
  await sampleFPS('3. Only Ambient/Hemi (Zero Forward Lights)');

  // Test 3: Hide bookshelves
  await page.evaluate(() => {
    window.__fantasticCtx.scene.traverse(obj => {
      if (obj.isInstancedMesh) obj.visible = false;
    });
  });
  await sampleFPS('4. Without Instanced Books');

  // Test 4: Hide terrain & exterior
  await page.evaluate(() => {
    const ext = window.__fantasticCtx.scene.getObjectByName('Exterior_Terrain_Pond_Stairs');
    if (ext) ext.visible = false;
  });
  await sampleFPS('5. Without Exterior Group');

  // Test 5: Hide Great Hall architecture
  await page.evaluate(() => {
    const hall = window.__fantasticCtx.scene.getObjectByName('Great_Hall_Architecture');
    if (hall) hall.visible = false;
  });
  await sampleFPS('6. Without Hall Architecture');

  await browser.close();
}

isolateSouth().catch(console.error);
