
import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function capture() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=d3d11']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  await page.goto('http://localhost:5173/?mode=game', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__fantasticWorldActive, { timeout: 10000 });
  await page.evaluate(() => document.getElementById('veil')?.click());
  await new Promise(r => setTimeout(r, 2000));
  
  // Look into the hall
  await page.evaluate(() => {
    const ctx = window.__fantasticCtx;
    if (ctx?.player) {
      ctx.player.position.set(0, 0, 6.5);
      ctx.yaw = Math.PI;
    }
  });
  await new Promise(r => setTimeout(r, 1000));
  
  const dest = 'C:\\Users\\Fabio D\\.gemini\\antigravity\\brain\\69a02808-eb44-47c0-ae6f-920c8e19911a\\fantastic_hall_warm_restored.png';
  await page.screenshot({ path: dest });
  console.log('Screenshot saved to:', dest);
  await browser.close();
}

capture().catch(console.error);
