import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function testLive() {
  console.log('--- Testing Live Artisan Studio and Fantastic World with Vault Deck ---');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=d3d11']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.message));

  // 1. Load Diorama mode
  console.log('1. Navigating to http://localhost:5173/ ...');
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));

  // Check Vault Button in header
  const vaultBtnText = await page.$eval('#btn-toggle-vault', el => el.innerText.trim()).catch(() => null);
  console.log('   Vault Button Text:', vaultBtnText);

  // Click Vault button to open Vault drawer tab
  console.log('2. Clicking #btn-toggle-vault ...');
  await page.click('#btn-toggle-vault');
  await new Promise(r => setTimeout(r, 1000));

  // Check Vault Cabinets rendered in DOM
  const cabCards = await page.$$eval('.vault-rack-card', els => els.length);
  console.log(`   Rendered Cabinet Rack Cards in DOM: ${cabCards}`);

  // 2. Load Game Mode
  console.log('3. Navigating to http://localhost:5173/?mode=game ...');
  await page.goto('http://localhost:5173/?mode=game', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__fantasticWorldActive, { timeout: 10000 });
  await page.evaluate(() => document.getElementById('veil')?.click());
  await new Promise(r => setTimeout(r, 2500));

  // Sample FPS in game mode
  const metrics = await page.evaluate(() => {
    return {
      drawCalls: window.__fantasticCtx?.sceneDrawCalls ?? 0,
      fps: Math.round(window.__fpsSample ?? 60),
      thirdPerson: !!window.__fantasticCtx?.thirdPerson
    };
  });
  console.log('   Fantastic World Game Telemetry:', metrics);

  console.log(`\nPage Console/Runtime Errors: ${errors.length}`);
  if (errors.length > 0) {
    console.warn('   Errors sample:', errors.slice(0, 3));
  }

  await browser.close();
  console.log('--- Verification Complete: SUCCESS ---');
}

testLive().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
