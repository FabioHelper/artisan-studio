import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function diagnose() {
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
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1.25 });

  console.log('Navigating to http://localhost:5173/?mode=game...');
  await page.goto('http://localhost:5173/?mode=game', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise(r => setTimeout(r, 2000));

  // Dismiss veil if present
  await page.evaluate(() => {
    const veil = document.getElementById('veil');
    if (veil) veil.click();
  });
  await new Promise(r => setTimeout(r, 1000));

  const diagnostics = await page.evaluate(() => {
    const artisan = window.__artisan;
    const fantastic = window.__fantasticCtx;
    const singleGuard = window.__singleInstanceGuard;

    // Count lights in fantastic scene
    let fantasticLights = 0;
    if (fantastic?.scene) {
      fantastic.scene.traverse(obj => {
        if (obj.isLight) fantasticLights++;
      });
    }

    // Count lights and meshes in diorama scene
    let dioramaChildren = 0;
    let dioramaLights = 0;
    if (artisan?.scene) {
      dioramaChildren = artisan.scene.children.length;
      artisan.scene.traverse(obj => {
        if (obj.isLight) dioramaLights++;
      });
    }

    return {
      hasArtisan: !!artisan,
      hasFantastic: !!fantastic,
      dioramaSceneChildren: dioramaChildren,
      dioramaLights,
      fantasticLights,
      fantasticCandleLightsCount: fantastic?.candleLights?.length || 0,
      rendererInfo: fantastic?.renderer ? {
        drawCalls: fantastic.renderer.info.render.calls,
        triangles: fantastic.renderer.info.render.triangles,
        points: fantastic.renderer.info.render.points,
        lines: fantastic.renderer.info.render.lines,
        frame: fantastic.renderer.info.render.frame,
        pixelRatio: fantastic.renderer.getPixelRatio(),
        viewport: [window.innerWidth, window.innerHeight]
      } : null,
      dprPreset: artisan?.getDPRPreset?.(),
      effectiveDPR: artisan?.computeEffectiveDPR?.(),
      hasComposer: !!fantastic?.composer,
      isAutoUpdateShadows: fantastic?.renderer?.shadowMap?.autoUpdate
    };
  });

  console.log('Diagnostics:', JSON.stringify(diagnostics, null, 2));

  // Benchmark FPS over 60 frames
  const fpsData = await page.evaluate(async () => {
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

  console.log('FPS Benchmark:', fpsData);

  // Take screenshot
  await page.screenshot({ path: 'scripts/game_mode_diag.png' });
  console.log('Screenshot saved to scripts/game_mode_diag.png');

  await browser.close();
}

diagnose().catch(console.error);
