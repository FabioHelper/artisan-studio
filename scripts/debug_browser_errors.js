import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function debugPage() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-webgl', '--ignore-gpu-blocklist']
  });

  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err.message));

  await page.goto('http://localhost:5173/?mode=game', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2000));

  const state = await page.evaluate(() => {
    return {
      hasArtisan: !!window.__artisan,
      hasCtx: !!window.__fantasticCtx,
      singleGuardStatus: window.__singleInstanceGuard?.getStatus?.()
    };
  });
  console.log('Final State:', state);

  await browser.close();
}

debugPage().catch(console.error);
