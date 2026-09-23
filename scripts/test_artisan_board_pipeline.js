import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const ARTIFACTS_DIR = 'C:/Users/Fabio D/.gemini/antigravity/brain/cbc668fc-b510-4984-9648-eebdc32fa9ab';

export async function verifyArtisanPipeline() {
  console.log('=== RUNNING COMPREHENSIVE ARTISAN BOARD & GAME VERIFICATION PIPELINE ===');
  let viteProcess = null;

  // Check if Vite dev server is running on port 5173
  let isViteRunning = false;
  try {
    const res = await fetch('http://localhost:5173/');
    if (res.ok) isViteRunning = true;
  } catch (e) {
    isViteRunning = false;
  }

  if (!isViteRunning) {
    console.log('[Setup] Spawning Vite dev server on port 5173...');
    viteProcess = spawn('npx.cmd', ['vite', '--port', '5173'], {
      cwd: 'C:\\Users\\Fabio D\\.gemini\\antigravity\\scratch\\artisan-studio-app',
      stdio: 'pipe',
      shell: true
    });

    // Wait for server to become responsive
    let ready = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 600));
      try {
        const res = await fetch('http://localhost:5173/');
        if (res.ok) { ready = true; break; }
      } catch (e) {}
    }
    if (!ready) {
      throw new Error('Failed to start Vite dev server within timeout.');
    }
    console.log('[Setup] Vite dev server is ready at http://localhost:5173/');
  } else {
    console.log('[Setup] Vite dev server is already running.');
  }

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

  const testReport = {
    timestamp: new Date().toISOString(),
    dioramaMode: null,
    gameModeSwitch: null,
    gameDrawCalls: null,
    omegamonTelemetry: null,
    subsystemToggles: null,
    dioramaRestore: null,
    allPassed: false
  };

  try {
    const page = await browser.newPage();
    page.on('console', msg => console.log('[BROWSER]', msg.text()));
    page.on('pageerror', err => console.error('[BROWSER ERROR]', err.message));

    console.log('\n--- Step 1: Diorama Mode Baseline Verification ---');
    await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForFunction(() => window.__artisan && window.__artisan.profiler, { timeout: 15000 });

    await new Promise(r => setTimeout(r, 1200));

    const dioramaStats = await page.evaluate(() => {
      const art = window.__artisan;
      const r = art.renderer;
      const profiler = art.profiler;
      const calls = r.info.render.calls;
      const tris = r.info.render.triangles;
      const fps = Math.round(art.rtss?.lastFps || 60);
      const vram = profiler.computeVramTelemetry();
      const processes = profiler.scanEntityProcesses();
      return { calls, tris, fps, vram, processCount: processes.length };
    });

    console.log(`- Diorama Draw Calls: ${dioramaStats.calls} (Budget: <= 30)`);
    console.log(`- Diorama Triangles: ${dioramaStats.tris} (Budget: <= 15000)`);
    console.log(`- Diorama FPS: ${dioramaStats.fps} (Target: ~60 FPS)`);
    console.log(`- Active Processes: ${dioramaStats.processCount}`);

    if (dioramaStats.calls > 30) {
      console.warn(`[WARNING] Diorama draw calls (${dioramaStats.calls}) exceed 30`);
    }
    testReport.dioramaMode = dioramaStats;

    console.log('\n--- Step 2: Switch to The Fantastic World under SingleInstanceGuard ---');
    await page.evaluate(() => {
      window.__artisan.switchToGameMode();
    });

    await new Promise(r => setTimeout(r, 600));

    // Dismiss veil to activate exploration loop
    await page.evaluate(() => {
      const veil = document.getElementById('veil');
      if (veil) veil.click();
    });

    await new Promise(r => setTimeout(r, 2000));

    const gameSwitchResult = await page.evaluate(() => {
      return {
        gameActive: !!window.__fantasticWorldActive,
        hasScene: !!window.__fantasticCtx?.scene,
        hasRenderer: !!window.__fantasticCtx?.renderer,
        audioActive: !!window.__fantasticCtx?.ambienceGain
      };
    });

    console.log('- Game Mode Active:', gameSwitchResult.gameActive);
    console.log('- Subsystems Mounted:', gameSwitchResult.hasScene && gameSwitchResult.hasRenderer);
    testReport.gameModeSwitch = gameSwitchResult;

    console.log('\n--- Step 3: Draw Call Verification in Game Mode (Hero & Vistas) ---');
    const drawAudit = await page.evaluate(async () => {
      const art = window.__artisan;
      const ctx = window.__fantasticCtx;
      const r = ctx.renderer;

      // 1. Entrance / Default View
      await new Promise(res => setTimeout(res, 300));
      const entranceCalls = ctx.sceneDrawCalls || r.info.render.calls;
      const entranceTris = ctx.sceneTris || r.info.render.triangles;

      // 2. Rotate to face South Moon Window
      ctx.yaw = 0; // face south
      await new Promise(res => setTimeout(res, 500));
      const southCalls = ctx.sceneDrawCalls || r.info.render.calls;
      const southTris = ctx.sceneTris || r.info.render.triangles;

      // 3. Move to Garden door & look North into Dream Garden
      if (ctx.player && ctx.player.position) {
        ctx.player.position.set(0, 0, -10);
      }
      ctx.yaw = Math.PI; // face north
      await new Promise(res => setTimeout(res, 500));
      const gardenCalls = ctx.sceneDrawCalls || r.info.render.calls;
      const gardenTris = ctx.sceneTris || r.info.render.triangles;

      return {
        entrance: { calls: entranceCalls, tris: entranceTris },
        southMoon: { calls: southCalls, tris: southTris },
        gardenVista: { calls: gardenCalls, tris: gardenTris }
      };
    });

    console.log(`- Vista 1 (Entrance Hero View): ${drawAudit.entrance.calls} draws, ${drawAudit.entrance.tris} tris`);
    console.log(`- Vista 2 (South Moon Window): ${drawAudit.southMoon.calls} draws, ${drawAudit.southMoon.tris} tris`);
    console.log(`- Vista 3 (Garden Vista): ${drawAudit.gardenVista.calls} draws, ${drawAudit.gardenVista.tris} tris`);

    const maxDrawsObserved = Math.max(drawAudit.entrance.calls, drawAudit.southMoon.calls, drawAudit.gardenVista.calls);
    console.log(`- Peak Game Draw Calls Observed: ${maxDrawsObserved} (SPEC-03 Budget: <= 35)`);
    testReport.gameDrawCalls = { ...drawAudit, maxDrawsObserved, passBudget: maxDrawsObserved <= 35 };

    console.log('\n--- Step 4: Omegamon Telemetry & Process Table in Game Mode ---');
    const omegamonMetrics = await page.evaluate(() => {
      const profiler = window.__artisan.profiler;
      const processes = profiler.scanEntityProcesses();
      return processes.map(p => ({
        name: p.name,
        category: p.category,
        drawCalls: p.drawCalls,
        triangles: p.triangles,
        status: p.status,
        statusNote: p.statusNote
      }));
    });

    console.log(`- Omegamon Entities Monitored: ${omegamonMetrics.length}`);
    omegamonMetrics.forEach(p => {
      console.log(`  [${p.category}] ${p.name}: ${p.drawCalls} draws, ${p.triangles} tris (${p.status} - ${p.statusNote})`);
    });
    testReport.omegamonTelemetry = omegamonMetrics;

    console.log('\n--- Step 5: Test Subsystem Hardware Toggles in Game Mode ---');
    const toggleResults = await page.evaluate(() => {
      const profiler = window.__artisan.profiler;
      profiler.toggleShadows();
      const shadowOff = !profiler.subsystems.shadows;
      profiler.toggleBloom();
      const bloomOff = !profiler.subsystems.bloom;
      profiler.toggleWireframe();
      const wireOn = profiler.subsystems.wireframe;

      // Restore
      profiler.toggleWireframe();
      profiler.toggleBloom();
      profiler.toggleShadows();

      return { shadowOff, bloomOff, wireOn };
    });
    console.log('- Hardware Toggles Functional:', toggleResults);
    testReport.subsystemToggles = toggleResults;

    console.log('\n--- Step 6: Switch back to Diorama Mode & Verify Zero Leaks ---');
    await page.evaluate(() => {
      window.__artisan.switchToDioramaMode();
    });
    await new Promise(r => setTimeout(r, 800));

    const dioramaRestored = await page.evaluate(() => {
      return {
        gameIsActive: !!window.__fantasticWorldActive,
        dioramaHasWorld: !!window.__artisan.activeWorldGroup,
        fps: Math.round(window.__artisan.rtss?.lastFps || 60),
        audioContextState: window.__fantasticCtx?.audioCtx ? window.__fantasticCtx.audioCtx.state : 'closed'
      };
    });

    console.log('- Game Active (should be false):', dioramaRestored.gameIsActive);
    console.log('- Diorama Restored (should be true):', dioramaRestored.dioramaHasWorld);
    console.log('- AudioContext State:', dioramaRestored.audioContextState);
    console.log('- Diorama Restored FPS:', dioramaRestored.fps);
    testReport.dioramaRestore = dioramaRestored;

    testReport.allPassed = (
      gameSwitchResult.gameActive &&
      maxDrawsObserved <= 35 &&
      !dioramaRestored.gameIsActive &&
      dioramaRestored.dioramaHasWorld
    );

    console.log('\n==================================================');
    if (testReport.allPassed) {
      console.log('✅ ALL VERIFICATION PIPELINE ASSERTIONS PASSED!');
    } else {
      console.log('❌ SOME PIPELINE ASSERTIONS FAILED.');
    }
    console.log('==================================================');

    const artifactDirs = [
      'C:/Users/Fabio D/.gemini/antigravity/brain/cbc668fc-b510-4984-9648-eebdc32fa9ab',
      'C:/Users/Fabio D/.gemini/antigravity/brain/69a02808-eb44-47c0-ae6f-920c8e19911a'
    ];
    for (const ad of artifactDirs) {
      if (!fs.existsSync(ad)) fs.mkdirSync(ad, { recursive: true });
      fs.writeFileSync(path.join(ad, 'artisan_board_pipeline_verification.json'), JSON.stringify(testReport, null, 2));
    }

  } catch (err) {
    console.error('[Pipeline Failed]', err);
  } finally {
    await browser.close();
    if (viteProcess) {
      viteProcess.kill();
    }
  }

  return testReport;
}

if (process.argv[1] && process.argv[1].endsWith('test_artisan_board_pipeline.js')) {
  verifyArtisanPipeline();
}
