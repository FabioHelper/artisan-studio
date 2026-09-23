import puppeteer from 'puppeteer-core';
import fs from 'fs';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function testMouseLook() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=d3d11']
  });

  try {
    const page = await browser.newPage();
    page.on('console', msg => console.log('[BROWSER]', msg.text()));

    await page.goto('http://localhost:5173/?mode=game', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__fantasticWorldActive, { timeout: 15000 });
    await new Promise(r => setTimeout(r, 1000));

    // Click veil to dismiss
    await page.evaluate(() => {
      const v = document.getElementById('veil');
      if (v) v.click();
    });
    await new Promise(r => setTimeout(r, 1000));

    await page.evaluate(() => {
      const canvas = window.__fantasticCtx.renderer.domElement;
      canvas.addEventListener('mousedown', e => console.log('CANVAS MOUSEDOWN', e.clientX, e.clientY));
      window.addEventListener('mousemove', e => {
        if (e.buttons > 0) {
          console.log('MOUSEMOVE', 'mov:', e.movementX, e.movementY, 'client:', e.clientX, e.clientY, 'locked:', window.__fantasticCtx.pointerLocked, 'yaw:', window.__fantasticCtx.yaw);
        }
      });
    });

    const box = await page.evaluate(() => {
      const rect = document.getElementById('webgl').getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    console.log('Canvas BoundingBox:', box);

    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 80, startY, { steps: 8 });
    await page.mouse.up();

    await new Promise(r => setTimeout(r, 500));
    const yawAfterLocked = await page.evaluate(() => window.__fantasticCtx.yaw);
    console.log('Initial Yaw:', Math.PI, 'Yaw After Locked Move:', yawAfterLocked, 'Delta 1:', yawAfterLocked - Math.PI);

    // Now exit pointer lock (press Escape) to test drag-to-look
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 300));
    const isLockedNow = await page.evaluate(() => window.__fantasticCtx.pointerLocked);
    console.log('Pointer locked after Escape:', isLockedNow);

    // Perform a drag-to-look
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 100, startY, { steps: 10 });
    await page.mouse.up();

    await new Promise(r => setTimeout(r, 500));
    const finalYaw = await page.evaluate(() => window.__fantasticCtx.yaw);
    console.log('Final Yaw After Drag:', finalYaw, 'Delta 2:', finalYaw - yawAfterLocked);

  } catch (err) {
    console.error('Test error:', err);
  } finally {
    await browser.close();
  }
}

testMouseLook();
