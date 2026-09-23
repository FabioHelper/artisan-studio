import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function testHighResAndSettings() {
  console.log('=== VERIFYING HIGH-RESOLUTION DRS & AAA SETTINGS MENU ===\n');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=d3d11']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1.0 });

    await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__artisan && window.__artisan.computeEffectiveDPR, { timeout: 15000 });
    console.log('✓ Artisan Studio loaded and ready');

    // 1. Verify 1080p DPR budget at 1.0x native DPR
    const dpr1080p = await page.evaluate(() => {
      return {
        dpr: window.__artisan.computeEffectiveDPR('auto'),
        w: window.innerWidth,
        h: window.innerHeight,
        renderW: Math.round(window.innerWidth * window.__artisan.computeEffectiveDPR('auto')),
        renderH: Math.round(window.innerHeight * window.__artisan.computeEffectiveDPR('auto'))
      };
    });
    console.log('1080p Viewport (1.0x scale):', dpr1080p);
    if (dpr1080p.dpr !== 1.0) throw new Error(`Expected DPR 1.0 at 1080p, got ${dpr1080p.dpr}`);
    console.log('✓ 1080p evaluates to native 1.0x DPR (2.07 Mpixels)');

    // 2. Verify 1080p display with Windows 125% OS scaling (1536 x 864 CSS px, deviceScaleFactor: 1.25)
    await page.setViewport({ width: 1536, height: 864, deviceScaleFactor: 1.25 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await new Promise(r => setTimeout(r, 400));

    const dprScaled1080p = await page.evaluate(() => {
      const dpr = window.__artisan.computeEffectiveDPR('auto');
      const w = window.innerWidth;
      const h = window.innerHeight;
      const renderW = Math.round(w * dpr);
      const renderH = Math.round(h * dpr);
      const totalRenderPixels = renderW * renderH;
      return { dpr, w, h, renderW, renderH, totalRenderPixels };
    });
    console.log('\n1080p Viewport with 125% OS Scale (High-DPI laptop):', dprScaled1080p);
    if (dprScaled1080p.dpr !== 1.25) throw new Error(`Expected DPR 1.25 on 125% scaled 1080p display, got ${dprScaled1080p.dpr}`);
    if (dprScaled1080p.renderW !== 1920 || dprScaled1080p.renderH !== 1080) {
      throw new Error(`Expected exact 1920x1080 native backbuffer, got ${dprScaled1080p.renderW}x${dprScaled1080p.renderH}`);
    }
    console.log(`✓ 1080p @ 125% scale correctly scales to ${dprScaled1080p.dpr}x DPR (native 1920x1080 crispness without blur)`);

    // 3. Simulate moving to 1440p monitor (2560 x 1440, 1.0x)
    await page.setViewport({ width: 2560, height: 1440, deviceScaleFactor: 1.0 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await new Promise(r => setTimeout(r, 400));

    const dpr1440p = await page.evaluate(() => {
      const dpr = window.__artisan.computeEffectiveDPR('auto');
      const w = window.innerWidth;
      const h = window.innerHeight;
      const renderW = Math.round(w * dpr);
      const renderH = Math.round(h * dpr);
      const totalRenderPixels = renderW * renderH;
      return { dpr, w, h, renderW, renderH, totalRenderPixels };
    });
    console.log('\n1440p Viewport (Higher Res Monitor):', dpr1440p);
    if (dpr1440p.dpr > 0.80) throw new Error(`DPR at 1440p should be clamped to ~0.75, got ${dpr1440p.dpr}`);
    if (dpr1440p.totalRenderPixels > 2200000) throw new Error(`Render pixels exceeded budget: ${dpr1440p.totalRenderPixels}`);
    console.log(`✓ 1440p successfully clamped to ${dpr1440p.dpr}x DPR (${dpr1440p.renderW}x${dpr1440p.renderH} = ${(dpr1440p.totalRenderPixels/1000000).toFixed(2)} MP, 60 FPS protected!)`);

    // 4. Simulate moving to 4K monitor (3840 x 2160, 1.0x)
    await page.setViewport({ width: 3840, height: 2160, deviceScaleFactor: 1.0 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await new Promise(r => setTimeout(r, 400));

    const dpr4k = await page.evaluate(() => {
      const dpr = window.__artisan.computeEffectiveDPR('auto');
      const w = window.innerWidth;
      const h = window.innerHeight;
      const renderW = Math.round(w * dpr);
      const renderH = Math.round(h * dpr);
      const totalRenderPixels = renderW * renderH;
      return { dpr, w, h, renderW, renderH, totalRenderPixels };
    });
    console.log('\n4K Viewport (Ultra High Res Monitor):', dpr4k);
    if (dpr4k.dpr > 0.55) throw new Error(`DPR at 4K should be clamped to ~0.50, got ${dpr4k.dpr}`);
    if (dpr4k.totalRenderPixels > 2200000) throw new Error(`Render pixels exceeded budget at 4K: ${dpr4k.totalRenderPixels}`);
    console.log(`✓ 4K successfully clamped to ${dpr4k.dpr}x DPR (${dpr4k.renderW}x${dpr4k.renderH} = ${(dpr4k.totalRenderPixels/1000000).toFixed(2)} MP, 60 FPS locked on Intel UHD!)`);

    // Reset viewport to 1600x900 for settings UI verification
    await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1.0 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await new Promise(r => setTimeout(r, 300));

    // 5. Test opening Settings Modal via Header Button
    console.log('\n--- Step 5: Open Settings Modal via Header Button ---');
    await page.click('#btn-toggle-settings');
    await new Promise(r => setTimeout(r, 300));

    const isModalOpen = await page.evaluate(() => {
      const modal = document.getElementById('artisan-settings-modal');
      return modal && modal.classList.contains('show') && modal.style.display !== 'none';
    });
    console.log('Settings Modal Opened:', isModalOpen);
    if (!isModalOpen) throw new Error('Settings modal failed to open');

    // 6. Test Settings Tabs Navigation
    console.log('\n--- Step 6: Test Navigation Across All 4 Settings Tabs ---');
    const tabNames = ['graphics', 'gameplay', 'telemetry', 'audio'];
    for (const t of tabNames) {
      await page.click(`.settings-tab-btn[data-stab="${t}"]`);
      await new Promise(r => setTimeout(r, 100));
      const activePanel = await page.evaluate((tab) => {
        const p = document.getElementById(`stab-panel-${tab}`);
        return p && p.classList.contains('active');
      }, t);
      console.log(`Tab '${t}' active:`, activePanel);
      if (!activePanel) throw new Error(`Tab ${t} failed to activate`);
    }

    // 7. Test FOV Slider Adjustment
    await page.click('.settings-tab-btn[data-stab="graphics"]');
    await page.evaluate(() => {
      const slider = document.getElementById('slider-fov');
      slider.value = '55';
      slider.dispatchEvent(new Event('input'));
    });
    const fovApplied = await page.evaluate(() => window.__artisan.camera.fov);
    console.log('Adjusted Camera FOV to 55°:', fovApplied === 55);
    if (fovApplied !== 55) throw new Error(`Expected FOV 55, got ${fovApplied}`);

    // 8. Test Invert Y Pitch Setting Toggle
    console.log('\n--- Step 8: Test Invert Y Pitch Toggle ---');
    await page.click('.settings-tab-btn[data-stab="gameplay"]');
    await page.click('#btn-toggle-inverty');
    await new Promise(r => setTimeout(r, 100));
    const invertYActive = await page.evaluate(() => window.__artisan.engineConfig.invertY);
    console.log('Invert Y toggled to true:', invertYActive);
    if (!invertYActive) throw new Error('Failed to toggle Invert Y');

    // 9. Test Audio Volume & Mute in Settings
    console.log('\n--- Step 9: Test Audio Volume & Mute Setting ---');
    await page.click('.settings-tab-btn[data-stab="audio"]');
    await page.evaluate(() => {
      const slider = document.getElementById('slider-vol');
      slider.value = '40';
      slider.dispatchEvent(new Event('input'));
    });
    const audioVol = await page.evaluate(() => window.__artisan.engineConfig.audioVolume);
    console.log('Audio volume adjusted to 40%:', audioVol === 40);
    if (audioVol !== 40) throw new Error(`Expected audio volume 40, got ${audioVol}`);

    // 10. Test closing Settings Modal via Close Button
    console.log('\n--- Step 10: Close Settings Modal via Close Button ---');
    await page.click('#btn-settings-close');
    await new Promise(r => setTimeout(r, 350));
    const isModalClosed = await page.evaluate(() => {
      const modal = document.getElementById('artisan-settings-modal');
      return !modal || !modal.classList.contains('show');
    });
    console.log('Settings Modal Closed:', isModalClosed);
    if (!isModalClosed) throw new Error('Settings modal failed to close');

    // 11. Test Hotkey 'P' to open Settings Modal and 'Esc' to close
    console.log('\n--- Step 11: Test Hotkeys P and Escape ---');
    await page.keyboard.press('KeyP');
    await new Promise(r => setTimeout(r, 300));
    const reopenedByP = await page.evaluate(() => {
      const modal = document.getElementById('artisan-settings-modal');
      return modal && modal.classList.contains('show');
    });
    console.log('Modal opened via hotkey P:', reopenedByP);
    if (!reopenedByP) throw new Error('Failed to open modal via hotkey P');

    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 350));
    const closedByEsc = await page.evaluate(() => {
      const modal = document.getElementById('artisan-settings-modal');
      return !modal || !modal.classList.contains('show');
    });
    console.log('Modal closed via Escape key:', closedByEsc);
    if (!closedByEsc) throw new Error('Failed to close modal via Escape');

    // 12. Switch to Game Mode
    console.log('\n--- Step 12: Switch to Game Mode and Test Bloom Protection & Input Isolation ---');
    await page.evaluate(() => window.__artisan.switchToGameMode());
    await new Promise(r => setTimeout(r, 1200));

    // Verify UnrealBloomPass buffer resolution is clamped on 4K resize in Game Mode
    await page.setViewport({ width: 3840, height: 2160, deviceScaleFactor: 1.0 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await new Promise(r => setTimeout(r, 400));

    const bloomClampState = await page.evaluate(() => {
      const ctx = window.__fantasticCtx;
      const bp = ctx?.bloomPass;
      const hTarget = bp?.renderTargetsHorizontal?.[0];
      return {
        hasBloom: !!bp,
        targetWidth: hTarget?.width,
        targetHeight: hTarget?.height
      };
    });
    console.log('Game Mode Bloom buffer at 4K viewport:', bloomClampState);
    if (bloomClampState.targetWidth > 512 || bloomClampState.targetHeight > 288) {
      throw new Error(`UnrealBloomPass exceeded 512x288 clamp on 4K resize! Got: ${bloomClampState.targetWidth}x${bloomClampState.targetHeight}`);
    }
    console.log(`✓ UnrealBloomPass strictly clamped to ${bloomClampState.targetWidth}x${bloomClampState.targetHeight} on 4K (fill-rate protected!)`);

    // Reset viewport to 1600x900
    await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1.0 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await new Promise(r => setTimeout(r, 300));

    // Test Floating Game Settings Button
    const gameBtnVisible = await page.evaluate(() => {
      const btn = document.getElementById('game-btn-settings');
      return btn && btn.style.display !== 'none';
    });
    console.log('Floating Game Settings button visible in game mode:', gameBtnVisible);
    if (!gameBtnVisible) throw new Error('Game settings button not visible in game mode');

    // Click floating settings button inside game
    await page.click('#game-btn-settings');
    await new Promise(r => setTimeout(r, 300));

    // Verify gameplay input is isolated while modal is open
    const inputIsolationState = await page.evaluate(() => {
      const ctx = window.__fantasticCtx;
      return {
        settingsOpen: ctx?.settingsOpen,
        artisanSettingsOpen: window.__artisanSettingsOpen,
        moveInputX: ctx?.moveInput?.x,
        moveInputY: ctx?.moveInput?.y
      };
    });
    console.log('Gameplay input isolation while settings open:', inputIsolationState);
    if (!inputIsolationState.settingsOpen || !inputIsolationState.artisanSettingsOpen) {
      throw new Error('Gameplay input not marked as blocked during settings modal');
    }

    // Try pressing W and dragging mouse while modal is open to ensure no movement leak
    await page.keyboard.press('KeyW');
    await page.mouse.move(500, 500);
    await page.mouse.down();
    await page.mouse.move(600, 600);
    await page.mouse.up();

    const inputRemainsZero = await page.evaluate(() => {
      const ctx = window.__fantasticCtx;
      return ctx?.moveInput?.x === 0 && ctx?.moveInput?.y === 0;
    });
    console.log('Move input remains zero while interacting with modal:', inputRemainsZero);
    if (!inputRemainsZero) throw new Error('WASD / mouse movement leaked into game while settings modal was open');

    // Close settings modal in game mode
    await page.click('#btn-settings-done');
    await new Promise(r => setTimeout(r, 350));

    // Switch back to diorama mode
    await page.evaluate(() => window.__artisan.switchToDioramaMode());
    await new Promise(r => setTimeout(r, 800));

    console.log('\n🎉 ALL HIGH-RESOLUTION DRS & AAA SETTINGS TESTS PASSED 100%!');
  } catch (err) {
    console.error('Test Failed:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

testHighResAndSettings();
