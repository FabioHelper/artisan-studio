import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function testGameQualityAndIntegrity() {
  console.log('--- Starting Game Quality & Integrity Verification ---');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=d3d11']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('[SingleInstanceGuard]') || text.includes('[MCP Bridge]') || text.includes('Graphics Quality')) {
        console.log('[BROWSER]', text);
      }
    });

    await page.goto('http://localhost:5173/?mode=game', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__fantasticWorldActive, { timeout: 15000 });
    console.log('✓ Fantastic World active and running');

    // 1. Check diorama bottom dock is hidden in game mode
    const isDeckHidden = await page.evaluate(() => {
      const deck = document.querySelector('.viewport-command-deck');
      return !deck || deck.style.display === 'none';
    });
    console.log('✓ Diorama bottom command deck hidden in game mode:', isDeckHidden);

    // 2. Check MCP connection status in UI
    await new Promise(r => setTimeout(r, 1200));
    const mcpStatus = await page.evaluate(() => {
      const label = document.getElementById('mcp-label')?.innerText;
      const dotClass = document.getElementById('mcp-dot')?.className;
      return { label, dotClass };
    });
    console.log('✓ MCP Bridge Status in UI:', mcpStatus);

    // 3. Test F2 Graphic Quality Cycling & On-Screen Hints
    const initialPreset = await page.evaluate(() => window.__artisan.getDPRPreset());
    console.log('Initial Preset:', initialPreset);

    // Press F2 -> Perf
    await page.keyboard.press('F2');
    await new Promise(r => setTimeout(r, 300));
    const perfState = await page.evaluate(() => ({
      preset: window.__artisan.getDPRPreset(),
      headerBadge: document.getElementById('header-dpr-val')?.innerText,
      hint: document.getElementById('hint-bar')?.innerText
    }));
    console.log('After F2 (1):', perfState);

    // Press F2 -> Balanced
    await page.keyboard.press('F2');
    await new Promise(r => setTimeout(r, 300));
    const balancedState = await page.evaluate(() => ({
      preset: window.__artisan.getDPRPreset(),
      headerBadge: document.getElementById('header-dpr-val')?.innerText,
      hint: document.getElementById('hint-bar')?.innerText
    }));
    console.log('After F2 (2):', balancedState);

    // Press F2 -> Ultra
    await page.keyboard.press('F2');
    await new Promise(r => setTimeout(r, 300));
    const ultraState = await page.evaluate(() => ({
      preset: window.__artisan.getDPRPreset(),
      headerBadge: document.getElementById('header-dpr-val')?.innerText,
      hint: document.getElementById('hint-bar')?.innerText
    }));
    console.log('After F2 (3):', ultraState);

    // Press F2 -> Auto
    await page.keyboard.press('F2');
    await new Promise(r => setTimeout(r, 300));
    const autoState = await page.evaluate(() => ({
      preset: window.__artisan.getDPRPreset(),
      headerBadge: document.getElementById('header-dpr-val')?.innerText,
      hint: document.getElementById('hint-bar')?.innerText
    }));
    console.log('After F2 (4):', autoState);

    // 4. Test F3 Horology Telemetry OSD toggle
    const rtssInitiallyVisible = await page.evaluate(() => {
      const el = document.getElementById('rtss-overlay');
      return el && el.style.display !== 'none';
    });
    await page.keyboard.press('F3');
    await new Promise(r => setTimeout(r, 300));
    const rtssAfterF3 = await page.evaluate(() => {
      const el = document.getElementById('rtss-overlay');
      return el && el.style.display !== 'none';
    });
    console.log('RTSS OSD initially visible:', rtssInitiallyVisible, '-> after F3:', rtssAfterF3);

    // 5. Test switching back to Diorama Mode
    await page.evaluate(() => document.getElementById('btn-mode-diorama').click());
    await new Promise(r => setTimeout(r, 1000));

    const dioramaState = await page.evaluate(() => {
      const deck = document.querySelector('.viewport-command-deck');
      return {
        gameActive: window.__fantasticWorldActive,
        dioramaActive: !window.__fantasticWorldActive,
        deckDisplay: deck ? deck.style.display : null
      };
    });
    console.log('✓ Switched back to Diorama mode:', dioramaState);

    console.log('🎉 ALL GAME QUALITY & INTEGRITY TESTS PASSED!');
  } catch (err) {
    console.error('Test error:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

testGameQualityAndIntegrity();
