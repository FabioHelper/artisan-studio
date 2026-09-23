import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function test() {
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
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__artisan && window.__artisan.loadScene);

  async function measureScene(sceneId) {
    await page.evaluate(id => {
      window.__artisan.switchToDioramaMode();
      window.__artisan.loadScene(id);
    }, sceneId);
    await new Promise(r => setTimeout(r, 2000));
    return await page.evaluate(async () => {
      return new Promise(resolve => {
        const samples = [];
        let count = 0;
        let last = performance.now();
        function loop(now) {
          const dt = now - last;
          last = now;
          if (count > 5) samples.push(dt);
          count++;
          if (count < 45) {
            requestAnimationFrame(loop);
          } else {
            const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
            resolve(1000 / avg);
          }
        }
        requestAnimationFrame(loop);
      });
    });
  }

  console.log('--- 1. CURRENT BASELINE (720p) ---');
  console.log('Tokyo:', (await measureScene('tokyo')).toFixed(1), 'FPS');
  console.log('Winterhold:', (await measureScene('winterhold')).toFixed(1), 'FPS');
  console.log('Tavern:', (await measureScene('tavern')).toFixed(1), 'FPS');

  console.log('\n--- 2. EXPERIMENT A: Disable PointLight shadows (hearthLight.castShadow = false) ---');
  await page.evaluate(() => {
    window.__artisan.scene.traverse(o => {
      if (o.isPointLight) o.castShadow = false;
    });
    window.__artisan.requestShadowBake(3);
  });
  console.log('Tavern (no point shadow):', (await measureScene('tavern')).toFixed(1), 'FPS');

  console.log('\n--- 3. EXPERIMENT B: Disable scene.environment (PMREM) completely ---');
  await page.evaluate(() => {
    window.__artisan.scene.environment = null;
  });
  console.log('Tokyo (no PMREM):', (await measureScene('tokyo')).toFixed(1), 'FPS');
  console.log('Winterhold (no PMREM):', (await measureScene('winterhold')).toFixed(1), 'FPS');
  console.log('Tavern (no PMREM):', (await measureScene('tavern')).toFixed(1), 'FPS');

  console.log('\n--- 4. EXPERIMENT C: BasicShadowMap instead of PCFShadowMap ---');
  await page.evaluate(() => {
    window.__artisan.renderer.shadowMap.type = 0; // THREE.BasicShadowMap
    window.__artisan.renderer.shadowMap.needsUpdate = true;
  });
  console.log('Tokyo (BasicShadowMap):', (await measureScene('tokyo')).toFixed(1), 'FPS');
  console.log('Winterhold (BasicShadowMap):', (await measureScene('winterhold')).toFixed(1), 'FPS');

  console.log('\n--- 5. EXPERIMENT D: Disable Shadows on Props (only floor and walls receive shadows) ---');
  await page.evaluate(() => {
    window.__artisan.activeWorldGroup.traverse(o => {
      if (o.isMesh && !o.name.includes('floor') && !o.name.includes('wall') && !o.name.includes('plinth')) {
        o.receiveShadow = false;
      }
    });
  });
  console.log('Winterhold (optimized receiveShadow):', (await measureScene('winterhold')).toFixed(1), 'FPS');

  console.log('\n--- 6. EXPERIMENT E: ALL COMBINED (No PMREM, No PointLight Shadow, 512px directional shadow) ---');
  await page.evaluate(() => {
    window.__artisan.scene.environment = null;
    window.__artisan.scene.traverse(o => {
      if (o.isPointLight) o.castShadow = false;
      if (o.isDirectionalLight) {
        o.shadow.mapSize.set(512, 512);
        o.shadow.map?.dispose();
        o.shadow.map = null;
      }
    });
    window.__artisan.requestShadowBake(3);
  });
  console.log('Tokyo (Combined):', (await measureScene('tokyo')).toFixed(1), 'FPS');
  console.log('Winterhold (Combined):', (await measureScene('winterhold')).toFixed(1), 'FPS');
  console.log('Tavern (Combined):', (await measureScene('tavern')).toFixed(1), 'FPS');
  console.log('Forge Trio (Combined):', (await measureScene('trio')).toFixed(1), 'FPS');

  await browser.close();
}

test().catch(console.error);
