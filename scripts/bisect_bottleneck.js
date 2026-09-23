import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function bisectBottleneck() {
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

  async function sample(label) {
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
          if (count < 45) requestAnimationFrame(loop);
          else resolve();
        }
        requestAnimationFrame(loop);
      });
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      return { fps: (1000 / avg).toFixed(1), ms: avg.toFixed(2) };
    });
    console.log(label, res);
    return res;
  }

  await sample('1. Base:');

  // Step A: Disable composer (raw renderer.render)
  await page.evaluate(() => {
    window.__fantasticCtx.composer.render = function() {
      window.__fantasticCtx.renderer.render(window.__fantasticCtx.scene, window.__fantasticCtx.camera);
    };
  });
  await sample('2. No Composer (raw render):');

  // Step B: Set devicePixelRatio to 1.0 (currently setViewport scaleFactor 1.25)
  await page.evaluate(() => {
    window.__fantasticCtx.renderer.setPixelRatio(1.0);
    window.__fantasticCtx.renderer.setSize(1280, 551);
  });
  await sample('3. DPR 1.0 (no scaleFactor 1.25):');

  // Step C: Check scene meshes count and types
  const breakdown = await page.evaluate(() => {
    let meshes = 0, points = 0, lights = 0;
    window.__fantasticCtx.scene.traverse(o => {
      if (o.isMesh) meshes++;
      if (o.isPoints) points++;
      if (o.isLight) lights++;
    });
    return { meshes, points, lights, calls: window.__fantasticCtx.renderer.info.render.calls };
  });
  console.log('Scene Breakdown:', breakdown);

  // Step D: Disable animations
  await page.evaluate(() => {
    window.__fantasticCtx.animations.length = 0;
  });
  await sample('4. No animations:');

  // Step E: Hide Hall
  await page.evaluate(() => {
    window.__fantasticCtx.scene.traverse(o => {
      if (o.name === 'Great_Hall_Architecture' || o.name === 'Hall_Props_And_Furniture') o.visible = false;
    });
  });
  await sample('5. Hide Hall & Props:');

  // Step F: Hide Exterior
  await page.evaluate(() => {
    window.__fantasticCtx.scene.traverse(o => {
      if (o.name === 'Exterior_Terrain_Pond_Stairs') o.visible = false;
    });
  });
  await sample('6. Hide Exterior too:');

  await browser.close();
}

bisectBottleneck().catch(console.error);
