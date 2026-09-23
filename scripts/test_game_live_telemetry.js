import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function testGameLive() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--use-angle=d3d11',
      '--window-size=1600,1000'
    ],
    defaultViewport: { width: 1600, height: 1000 }
  });

  try {
    const page = await browser.newPage();
    page.on('console', msg => console.log('[BROWSER]', msg.text()));
    page.on('pageerror', err => console.error('[BROWSER ERROR]', err.message));

    console.log('Navigating to http://localhost:5173/ ...');
    await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__artisan && window.__artisan.switchToGameMode, { timeout: 15000 });

    console.log('Switching to Game Mode...');
    await page.evaluate(() => window.__artisan.switchToGameMode());

    // Dismiss veil
    await page.evaluate(() => {
      const v = document.getElementById('veil');
      if (v) v.click();
    });

    // Let it run for 2.5 seconds to accumulate frames and cycle telemetry
    console.log('Running game loop for 2.5s...');
    await new Promise(r => setTimeout(r, 2500));

    const telemetry = await page.evaluate(() => {
      const hudFps = document.getElementById('hud-fps')?.innerText;
      const hudDraws = document.getElementById('hud-drawcalls')?.innerText;
      const hudTris = document.getElementById('hud-triangles')?.innerText;
      const btnDpr = document.getElementById('btn-toggle-dpr')?.innerText;
      const currentDpr = window.__fantasticCtx?.renderer?.getPixelRatio();
      const shadowAuto = window.__fantasticCtx?.renderer?.shadowMap?.autoUpdate;
      return {
        hudFps,
        hudDraws,
        hudTris,
        btnDpr,
        currentDpr,
        shadowAuto,
        gameActive: window.__fantasticWorldActive
      };
    });

    console.log('\n--- LIVE GAME TELEMETRY VERIFICATION ---');
    console.log(JSON.stringify(telemetry, null, 2));

    // Now test toggling DPR to Performance mode (0.85x)
    console.log('\nTesting DPR toggle to Performance...');
    await page.evaluate(() => window.__artisan.applyDPRPreset('perf'));
    await new Promise(r => setTimeout(r, 500));

    const perfTelemetry = await page.evaluate(() => {
      const btnDpr = document.getElementById('btn-toggle-dpr')?.innerText;
      const currentDpr = window.__fantasticCtx?.renderer?.getPixelRatio();
      const composerDpr = window.__fantasticCtx?.composer?.getPixelRatio ? window.__fantasticCtx.composer.getPixelRatio() : null;
      return { btnDpr, currentDpr, composerDpr };
    });
    console.log('Performance DPR Result:', perfTelemetry);

    // Now test toggling back to Auto 60 FPS
    console.log('\nTesting DPR toggle back to Auto 60 FPS...');
    await page.evaluate(() => window.__artisan.applyDPRPreset('auto'));
    await new Promise(r => setTimeout(r, 500));

    const autoTelemetry = await page.evaluate(() => {
      const btnDpr = document.getElementById('btn-toggle-dpr')?.innerText;
      const currentDpr = window.__fantasticCtx?.renderer?.getPixelRatio();
      return { btnDpr, currentDpr };
    });
    console.log('Auto DPR Result:', autoTelemetry);

  } catch (err) {
    console.error('Test error:', err);
  } finally {
    await browser.close();
  }
}

testGameLive();
