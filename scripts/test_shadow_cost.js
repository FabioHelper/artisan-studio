import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function testShadowMapCost() {
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

  await benchmark('1. Base with PCFSoftShadowMap (2048):');

  // Test 2: Switch to PCFShadowMap
  await page.evaluate(() => {
    window.__fantasticCtx.renderer.shadowMap.type = 1; // THREE.PCFShadowMap
    window.__fantasticCtx.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  });
  await new Promise(r => setTimeout(r, 1000));
  await benchmark('2. PCFShadowMap (harder filter):');

  // Test 3: Set shadow map to 1024
  await page.evaluate(() => {
    window.__fantasticCtx.scene.traverse(o => {
      if (o.isDirectionalLight && o.shadow) {
        o.shadow.mapSize.set(1024, 1024);
        o.shadow.map?.dispose();
        o.shadow.map = null;
      }
    });
  });
  await new Promise(r => setTimeout(r, 1000));
  await benchmark('3. 1024 ShadowMap:');

  // Test 4: Disable shadowMap autoUpdate (cache moonlight shadow!)
  await page.evaluate(() => {
    window.__fantasticCtx.renderer.shadowMap.autoUpdate = false;
    window.__fantasticCtx.renderer.shadowMap.needsUpdate = true;
  });
  await new Promise(r => setTimeout(r, 1000));
  await benchmark('4. Cached ShadowMap (autoUpdate=false):');

  await browser.close();
}

testShadowMapCost().catch(console.error);
