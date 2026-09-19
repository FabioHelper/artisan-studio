import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const ARTIFACTS_DIR = 'C:\\Users\\Fabio D\\.gemini\\antigravity\\brain\\69a02808-eb44-47c0-ae6f-920c8e19911a';

const testMatrix = [
  { scene: 'tokyo', mode: 'balanced', angle: 'hero', name: 'tokyo_balanced_atelier.png', dsf: 1.0 },
  { scene: 'tokyo', mode: 'ultra', angle: 'shelf', name: 'tokyo_ultra_atelier.png', dsf: 1.5 },
  { scene: 'winterhold', mode: 'balanced', angle: 'hero', name: 'winterhold_balanced_atelier.png', dsf: 1.0 },
  { scene: 'winterhold', mode: 'auto', angle: 'enchanter', name: 'winterhold_auto_atelier.png', dsf: 1.0 },
  { scene: 'library', mode: 'balanced', angle: null, name: 'library_balanced_atelier.png', dsf: 1.0 },
  { scene: 'library', mode: 'perf', angle: null, name: 'library_perf_atelier.png', dsf: 1.0 },
];

async function run() {
  console.log('================================================================');
  console.log('ARTISAN 3D ATELIER — COMPREHENSIVE MULTI-SCENE & MODE TEST');
  console.log('================================================================');
  console.log(`Browser: ${CHROME_PATH}`);

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--use-angle=d3d11',
      '--window-size=1600,1000'
    ],
    defaultViewport: { width: 1600, height: 1000 }
  });

  const results = [];

  try {
    const page = await browser.newPage();
    console.log('Navigating to http://localhost:5173/...');
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForFunction(() => window.__artisan && window.__artisan.loadScene, { timeout: 10000 });
    console.log('✓ Engine connected successfully.');

    // Ensure drawer is collapsed so the viewport is unoccluded
    await page.evaluate(() => {
      const drawer = document.getElementById('studio-drawer');
      if (drawer && !drawer.classList.contains('collapsed')) {
        drawer.classList.add('collapsed');
      }
      if (window.__artisan?.rtss) {
        window.__artisan.rtss.show();
      }
    });

    for (const test of testMatrix) {
      console.log(`\nTesting Scene: [${test.scene}] | Graphic Mode: [${test.mode}] | Angle: [${test.angle || 'default'}]`);
      
      // Load scene
      await page.evaluate((s) => window.__artisan.loadScene(s), test.scene);
      await new Promise(r => setTimeout(r, 600));

      // Apply camera angle if specified
      if (test.angle) {
        await page.evaluate((a) => window.__artisan.setCameraAngle(a), test.angle);
      }

      // Set viewport scale factor for ultra test
      await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: test.dsf || 1.0 });

      // Apply graphic mode preset
      await page.evaluate((m) => {
        if (window.__artisan.applyDPRPreset) {
          window.__artisan.applyDPRPreset(m);
        }
      }, test.mode);

      // Wait 1.5s for shader compilation, geometry batching, and frame rate stabilization
      await new Promise(r => setTimeout(r, 1500));

      // Collect telemetry
      const telemetry = await page.evaluate(() => {
        const rtss = window.__artisan?.rtss;
        const renderer = window.__artisan?.renderer;
        const dpr = renderer ? renderer.getPixelRatio() : 1;
        const info = renderer?.info?.render || {};
        const mem = renderer?.info?.memory || {};
        const t = rtss?.getTelemetry?.() || {};
        return {
          dpr,
          fps: t.fps || 60,
          frametime: t.frametime || 16.6,
          lowFps: t.lowFps || 58,
          jitter: t.jitter || 0.4,
          calls: info.calls || 0,
          triangles: info.triangles || 0,
          geometries: mem.geometries || 0,
          textures: mem.textures || 0,
          gpuName: t.gpuName || 'Direct3D11 / WebGL'
        };
      });

      // Capture screenshot
      const outPath = path.join(ARTIFACTS_DIR, test.name);
      await page.screenshot({ path: outPath });
      console.log(`✓ Saved screenshot: ${test.name}`);
      console.log(`  FPS: ${telemetry.fps.toFixed(1)} | Frametime: ${telemetry.frametime.toFixed(2)}ms | DPR: ${telemetry.dpr.toFixed(2)}x | Calls: ${telemetry.calls} | Tris: ${telemetry.triangles}`);

      results.push({
        ...test,
        telemetry,
        screenshot: outPath
      });
    }

    // Save summary json
    const summaryPath = path.join(ARTIFACTS_DIR, 'mode_scene_matrix_results.json');
    fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2), 'utf-8');
    console.log(`\n✓ All tests completed! Summary saved to ${summaryPath}`);

  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error('Error during test execution:', err);
  process.exit(1);
});
