import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import os from 'os';

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const execPath = fs.existsSync(edgePath) ? edgePath : chromePath;

export const ARTIFACTS_DIR = 'C:\\Users\\Fabio D\\.gemini\\antigravity\\brain\\69a02808-eb44-47c0-ae6f-920c8e19911a';

/**
 * Launch an isolated Chromium instance configured with ANGLE Direct3D11 hardware acceleration
 */
export async function launchBrowser(width = 1280, height = 720) {
  const uniqueUserDataDir = path.join(os.tmpdir(), `artisan_mcp_${Date.now()}`);
  return await puppeteer.launch({
    executablePath: execPath,
    headless: 'new',
    userDataDir: uniqueUserDataDir,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-gl=angle',
      '--use-angle=d3d11',
      '--enable-webgl',
      `--window-size=${width},${height}`
    ]
  });
}

/**
 * Executes empirical 7-point performance audit headlessly
 */
export async function runHeadlessAudit(scene = 'tokyo') {
  const browser = await launchBrowser(1280, 720);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForSelector('#webgl');
    await new Promise(r => setTimeout(r, 1200));

    // Ensure desired scene is loaded
    if (scene) {
      await page.evaluate((s) => {
        if (window.__artisan?.loadScene) window.__artisan.loadScene(s);
      }, scene);
      await new Promise(r => setTimeout(r, 1000));
    }

    // Run audit
    const report = await page.evaluate(async () => {
      if (window.__artisan?.profiler) {
        return await window.__artisan.profiler.runAudit();
      }
      return null;
    });

    if (!report) {
      throw new Error('Profiler was not initialized on page');
    }

    // Generate Markdown representation
    const md = await page.evaluate(() => {
      return window.__artisan?.profiler?.formatAuditMarkdown?.() || '';
    });

    // Save persistent reports into artifacts directory
    if (!fs.existsSync(ARTIFACTS_DIR)) {
      fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    }

    const jsonPath = path.join(ARTIFACTS_DIR, 'perf_audit_report.json');
    const mdPath = path.join(ARTIFACTS_DIR, 'perf_audit_report.md');
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
    fs.writeFileSync(mdPath, md, 'utf-8');

    return { report, md, jsonPath, mdPath };
  } finally {
    await browser.close();
  }
}

/**
 * Captures high-res screenshot of the active viewport including RTSS hardware OSD
 */
export async function captureHeadlessScreenshot({ filename = 'artisan_capture.png', angle = null, scene = null, width = 1280, height = 720 }) {
  const browser = await launchBrowser(width, height);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForSelector('#webgl');
    await new Promise(r => setTimeout(r, 1200));

    // Collapse drawer if open so viewport is clean
    await page.evaluate(() => {
      const drawer = document.getElementById('studio-drawer');
      if (drawer && !drawer.classList.contains('collapsed')) {
        drawer.classList.add('collapsed');
      }
    });

    if (scene) {
      await page.evaluate((s) => {
        if (window.__artisan?.loadScene) window.__artisan.loadScene(s);
      }, scene);
      await new Promise(r => setTimeout(r, 800));
    }

    if (angle) {
      await page.evaluate((a) => {
        if (window.__artisan?.setCameraAngle) window.__artisan.setCameraAngle(a);
      }, angle);
      await new Promise(r => setTimeout(r, 800));
    }

    if (!fs.existsSync(ARTIFACTS_DIR)) {
      fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    }

    const targetFile = path.join(ARTIFACTS_DIR, filename);
    await page.screenshot({ path: targetFile });

    const telemetry = await page.evaluate(() => {
      return window.__artisan?.rtss?.getTelemetry?.() || {};
    });

    return {
      filePath: targetFile,
      telemetry,
      filename
    };
  } finally {
    await browser.close();
  }
}

/**
 * Queries instantaneous engine telemetry headlessly
 */
export async function getHeadlessTelemetry() {
  const browser = await launchBrowser(1280, 720);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForSelector('#webgl');
    await new Promise(r => setTimeout(r, 1000));

    return await page.evaluate(() => {
      return window.__artisan?.rtss?.getTelemetry?.() || {};
    });
  } finally {
    await browser.close();
  }
}
