import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

import os from 'os';

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const execPath = fs.existsSync(edgePath) ? edgePath : chromePath;

const outDir = 'C:\\Users\\Fabio D\\.gemini\\antigravity\\brain\\69a02808-eb44-47c0-ae6f-920c8e19911a';

async function capture() {
  console.log(`Using browser: ${execPath}`);
  const uniqueUserDataDir = path.join(os.tmpdir(), `artisan_puppeteer_${Date.now()}`);
  const browser = await puppeteer.launch({
    executablePath: execPath,
    headless: 'new',
    userDataDir: uniqueUserDataDir,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-gl=angle',
      '--use-angle=d3d11',
      '--enable-webgl',
      '--window-size=1280,720'
    ]
  });

  const page = await browser.newPage();
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  page.on('pageerror', err => console.error('BROWSER PAGE ERROR:', err));
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });

  console.log('Navigating to http://localhost:5173/ ...');
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForSelector('#webgl');

  // Wait 1.5 seconds for Three.js scene initialization
  await new Promise(r => setTimeout(r, 1500));

  // Ensure drawer is collapsed for clear view of props and altars
  await page.evaluate(() => {
    const drawer = document.getElementById('studio-drawer');
    if (drawer && !drawer.classList.contains('collapsed')) {
      drawer.classList.add('collapsed');
    }
  });

  // Load and capture Tokyo Nintendo Office scene in 3 detailed angles
  console.log('Loading Tokyo Nintendo Office scene...');
  await page.evaluate(() => {
    if (window.__artisan && window.__artisan.loadScene) {
      window.__artisan.loadScene('tokyo');
    }
  });
  await new Promise(r => setTimeout(r, 1500));

  const tokyoTelemetry = await page.evaluate(() => ({
    hudDrawCalls: document.getElementById('hud-drawcalls')?.innerText || 'unknown',
    hudTriangles: document.getElementById('hud-triangles')?.innerText || 'unknown',
    hudFps: document.getElementById('hud-fps')?.innerText || 'unknown',
    renderCalls: window.__artisan?.renderer?.info?.render?.calls,
    renderTriangles: window.__artisan?.renderer?.info?.render?.triangles,
    geometries: window.__artisan?.renderer?.info?.memory?.geometries
  }));
  console.log('Tokyo Telemetry:', JSON.stringify(tokyoTelemetry, null, 2));

  const tokyoAngles = [
    {
      name: 'Hero View',
      file: 'tokyo_hero.png',
      cam: [3.4, 2.3, 3.4],
      target: [0, 0.95, -0.2]
    },
    {
      name: 'Workstation Close-Up',
      file: 'tokyo_workstation_macro.png',
      cam: [0.12, 1.06, 0.22],
      target: [-0.02, 0.94, -0.22]
    },
    {
      name: 'Balcony & Skyline View',
      file: 'tokyo_skyline.png',
      cam: [-0.7, 1.25, 0.7],
      target: [0.2, 1.35, -2.0]
    }
  ];

  for (const tAngle of tokyoAngles) {
    console.log(`Setting Tokyo angle: ${tAngle.name}...`);
    await page.evaluate((camPos, tgtPos) => {
      const { camera, controls } = window.__artisan;
      camera.position.set(...camPos);
      controls.target.set(...tgtPos);
      controls.update();
    }, tAngle.cam, tAngle.target);

    await new Promise(r => setTimeout(r, 800));
    const destPath = path.join(outDir, tAngle.file);
    await page.screenshot({ path: destPath });
    console.log(`✓ Saved screenshot: ${destPath}`);
  }

  // Also verify Winterhold with new lighting profile
  console.log('Loading Winterhold College scene...');
  await page.evaluate(() => {
    if (window.__artisan && window.__artisan.loadScene) {
      window.__artisan.loadScene('winterhold');
    }
  });
  await new Promise(r => setTimeout(r, 1200));

  const winterholdAngles = [
    {
      name: 'Winterhold Full Hero',
      file: 'winterhold_hero.png',
      cam: [3.4, 2.6, 3.6],
      target: [0, 1.2, 0]
    },
    {
      name: 'Winterhold Enchanter Skull',
      file: 'winterhold_enchanter_skull.png',
      cam: [0.08, 1.25, 0.45],
      target: [-0.02, 1.15, -0.4]
    }
  ];

  for (const wAngle of winterholdAngles) {
    console.log(`Setting Winterhold angle: ${wAngle.name}...`);
    await page.evaluate((camPos, tgtPos) => {
      const { camera, controls } = window.__artisan;
      camera.position.set(...camPos);
      controls.target.set(...tgtPos);
      controls.update();
    }, wAngle.cam, wAngle.target);

    await new Promise(r => setTimeout(r, 800));
    const destPath = path.join(outDir, wAngle.file);
    await page.screenshot({ path: destPath });
    console.log(`✓ Saved screenshot: ${destPath}`);
  }

  await browser.close();
  console.log('🎉 All screenshots and benchmarks captured successfully!');
}

capture().catch(err => {
  console.error('Error capturing screenshots:', err);
  process.exit(1);
});
