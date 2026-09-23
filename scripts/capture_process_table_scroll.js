import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const ARTIFACTS_DIR = 'C:/Users/Fabio D/.gemini/antigravity/brain/69a02808-eb44-47c0-ae6f-920c8e19911a';

async function run() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=d3d11', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 }
  });

  try {
    const page = await browser.newPage();
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForFunction(() => window.__artisan && window.__artisan.switchToGameMode, { timeout: 10000 });

    // Switch to game mode
    await page.evaluate(() => {
      window.__artisan.switchToGameMode();
      const veil = document.getElementById('veil');
      if (veil) veil.click();
    });

    await new Promise(r => setTimeout(r, 2000));

    // Open Task Manager tab and scroll down to the Process Table
    await page.evaluate(() => {
      const drawer = document.getElementById('studio-drawer');
      drawer.classList.remove('collapsed');
      document.querySelectorAll('.drawer-tab').forEach(t => t.classList.remove('active'));
      const taskTab = document.querySelector('.drawer-tab[data-tab="taskmgr"]');
      taskTab.classList.add('active');
      document.getElementById('tab-manifest').style.display = 'none';
      document.getElementById('tab-roi').style.display = 'none';
      document.getElementById('tab-llm').style.display = 'none';
      const tm = document.getElementById('tab-taskmgr');
      tm.style.display = 'flex';
      window.__artisan.profiler.renderProcessTable();
      window.__artisan.profiler.updateLiveMeters();
      // Scroll drawer down to the table
      tm.scrollTop = 520;
    });

    await new Promise(r => setTimeout(r, 400));
    const tableShot = path.join(ARTIFACTS_DIR, 'fantastic_game_process_table_detail.png');
    await page.screenshot({ path: tableShot });
    console.log('Saved:', tableShot);

  } finally {
    await browser.close();
  }
}
run();
