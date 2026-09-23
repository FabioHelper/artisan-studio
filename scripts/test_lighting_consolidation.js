import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function testLightingConsolidation() {
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
    ],
    defaultViewport: { width: 1280, height: 720 }
  });

  const page = await browser.newPage();
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__artisan && window.__artisan.loadScene, { timeout: 10000 });

  async function getFps() {
    return await page.evaluate(async () => {
      return new Promise(resolve => {
        let count = 0, last = performance.now(), samples = [];
        function loop(now) {
          if (count > 5) samples.push(now - last);
          last = now;
          count++;
          if (count < 35) requestAnimationFrame(loop);
          else resolve(1000 / (samples.reduce((a, b) => a + b, 0) / samples.length));
        }
        requestAnimationFrame(loop);
      });
    });
  }

  // 1. Measure Tokyo Baseline
  await page.evaluate(() => window.__artisan.loadScene('tokyo'));
  await new Promise(r => setTimeout(r, 1500));
  const tokyoBase = await getFps();
  const tokyoLightsBefore = await page.evaluate(() => {
    let count = 0;
    window.__artisan.scene.traverse(o => { if (o.isLight) count++; });
    return count;
  });
  console.log(`Tokyo Baseline: ${tokyoBase.toFixed(1)} FPS (${tokyoLightsBefore} lights in scene)`);

  // 2. Disable child lights in Tokyo (keep only LightingRig lights: Key, Fill, Hemi)
  await page.evaluate(() => {
    window.__artisan.activeWorldGroup.traverse(o => {
      if (o.isLight) o.visible = false;
    });
  });
  const tokyoNoChildLights = await getFps();
  const tokyoLightsAfter = await page.evaluate(() => {
    let count = 0;
    window.__artisan.scene.traverse(o => { if (o.isLight && o.visible) count++; });
    return count;
  });
  console.log(`Tokyo Without Redundant Child Lights: ${tokyoNoChildLights.toFixed(1)} FPS (${tokyoLightsAfter} active lights)`);

  // 3. Measure Winterhold Baseline
  await page.evaluate(() => window.__artisan.loadScene('winterhold'));
  await new Promise(r => setTimeout(r, 1500));
  const winterBase = await getFps();
  const winterLightsBefore = await page.evaluate(() => {
    let count = 0;
    window.__artisan.scene.traverse(o => { if (o.isLight) count++; });
    return count;
  });
  console.log(`Winterhold Baseline: ${winterBase.toFixed(1)} FPS (${winterLightsBefore} lights in scene)`);

  // 4. Disable child lights in Winterhold
  await page.evaluate(() => {
    window.__artisan.activeWorldGroup.traverse(o => {
      if (o.isLight) o.visible = false;
    });
  });
  const winterNoChildLights = await getFps();
  const winterLightsAfter = await page.evaluate(() => {
    let count = 0;
    window.__artisan.scene.traverse(o => { if (o.isLight && o.visible) count++; });
    return count;
  });
  console.log(`Winterhold Without Redundant Child Lights: ${winterNoChildLights.toFixed(1)} FPS (${winterLightsAfter} active lights)`);

  // 5. Measure Tavern Baseline and without child lights
  await page.evaluate(() => window.__artisan.loadScene('tavern'));
  await new Promise(r => setTimeout(r, 1500));
  const tavernBase = await getFps();
  await page.evaluate(() => {
    window.__artisan.activeWorldGroup.traverse(o => {
      if (o.isLight) o.visible = false;
    });
  });
  const tavernNoChild = await getFps();
  console.log(`Tavern Baseline: ${tavernBase.toFixed(1)} FPS -> Without Child Lights: ${tavernNoChild.toFixed(1)} FPS`);

  await browser.close();
}

testLightingConsolidation().catch(console.error);
