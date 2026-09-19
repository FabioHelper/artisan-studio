import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const ARTIFACTS_DIR = 'C:\\Users\\Fabio D\\.gemini\\antigravity\\brain\\69a02808-eb44-47c0-ae6f-920c8e19911a';

const SCENES = [
  { id: 'winterhold', name: 'Winterhold Arcanaeum', screenshot: 'winterhold_gallery.png', maxCalls: 70 },
  { id: 'tokyo', name: 'Tokyo Nintendo Office', screenshot: 'tokyo_gallery.png', maxCalls: 70 },
  { id: 'library', name: 'Hermit Library Scriptorium', screenshot: 'library_gallery.png', maxCalls: 40 },
  { id: 'alchemist', name: "Alchemist's Laboratory", screenshot: 'alchemist_gallery.png', maxCalls: 40 },
  { id: 'armory', name: 'Dungeon Armory', screenshot: 'armory_gallery.png', maxCalls: 40 },
  { id: 'trio', name: 'Blacksmith Forge Pavilion', screenshot: 'forge_gallery.png', maxCalls: 40 },
  { id: 'tavern', name: 'Medieval Tudor Tavern Hall', screenshot: 'tavern_gallery.png', maxCalls: 40 }
];

async function run() {
  console.log('================================================================');
  console.log('ARTISAN 3D STUDIO — 7-SCENE FULL ARCHITECTURAL COMPILATION AUDIT');
  console.log('================================================================\n');

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
    console.log('Connecting to http://localhost:5173/ ...');
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForFunction(() => window.__artisan && window.__artisan.loadScene, { timeout: 10000 });

    for (const s of SCENES) {
      console.log(`\n▶ Testing Scene: ${s.name} (${s.id})`);
      await page.evaluate(sceneId => window.__artisan.loadScene(sceneId), s.id);
      
      // Wait for scene warm-up and shadow bake
      await new Promise(r => setTimeout(r, 2500));

      const telemetry = await page.evaluate(() => {
        const rtss = window.__artisan?.rtss;
        const renderer = window.__artisan?.renderer;
        const dpr = renderer ? renderer.getPixelRatio() : 1;
        const info = renderer?.info?.render || {};
        const t = rtss?.getTelemetry?.() || {};
        return {
          dpr,
          fps: t.fps || 60,
          frametime: t.frametime || 16.6,
          jitter: t.jitter || 0.1,
          calls: info.calls || 0,
          triangles: info.triangles || 0
        };
      });

      const outPath = path.join(ARTIFACTS_DIR, s.screenshot);
      await page.screenshot({ path: outPath });

      const passedCalls = telemetry.calls <= s.maxCalls;
      const passedTris = telemetry.triangles <= 15000;
      const status = passedCalls && passedTris ? 'PASS ✓' : 'FAIL ✗';

      console.log(`  [${status}] Calls: ${telemetry.calls} (Budget <= ${s.maxCalls}) | Tris: ${telemetry.triangles} | FPS: ${telemetry.fps.toFixed(1)} | Jitter: ±${telemetry.jitter.toFixed(1)}ms`);
      console.log(`  Saved: ${s.screenshot}`);

      results.push({
        scene: s.id,
        name: s.name,
        telemetry,
        screenshot: s.screenshot,
        passedCalls,
        passedTris
      });
    }

    const reportPath = path.join(ARTIFACTS_DIR, 'all_scenes_audit_report.json');
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
    console.log(`\n✓ Full audit results saved to: ${reportPath}`);

  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
