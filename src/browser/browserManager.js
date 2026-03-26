const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());
const { createComponentLogger } = require('../utils/logger');
const { loadAppConfig } = require('../utils/config');

const log = createComponentLogger('Browser');

let browser = null;
let context = null;
let page = null;

/**
 * Initialize Playwright browser with human-like settings
 */
const PROXIES = [
  '31.59.20.176:6754:njaztstr:dfulqprhrd34',
  '23.95.150.145:6114:njaztstr:dfulqprhrd34',
  '198.23.239.134:6540:njaztstr:dfulqprhrd34',
  '45.38.107.97:6014:njaztstr:dfulqprhrd34',
  '107.172.163.27:6543:njaztstr:dfulqprhrd34',
  '198.105.121.200:6462:njaztstr:dfulqprhrd34',
  '216.10.27.159:6837:njaztstr:dfulqprhrd34',
  '142.111.67.146:5611:njaztstr:dfulqprhrd34',
  '191.96.254.138:6185:njaztstr:dfulqprhrd34',
  '31.58.9.4:6077:njaztstr:dfulqprhrd34',
];

function getRandomProxy() {
  const entry = PROXIES[Math.floor(Math.random() * PROXIES.length)];
  const [host, port, username, password] = entry.split(':');
  return { server: `http://${host}:${port}`, username, password };
}

async function initBrowser() {
  const config = loadAppConfig();
  const proxy = getRandomProxy();

  log.info(`Launching browser (headless: ${config.headless})...`);
  log.info(`Using proxy: ${proxy.server}`);

  browser = await chromium.launch({
    headless: config.headless,
    slowMo: config.slowMotion,
    proxy,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--disable-gpu',                 // Required for headless on GCP / Linux VMs
      '--disable-dev-shm-usage',       // Prevents crashes in containers with small /dev/shm
      '--disable-extensions',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  context = await browser.newContext({
    userAgent: config.userAgent,
    viewport: { width: 1366, height: 768 },
    locale: 'en-IN',
    timezoneId: config.timezone,
    // Disable webdriver flag to avoid detection
    javaScriptEnabled: true,
  });

  // Spoof navigator.webdriver to avoid bot detection
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
    // Override chrome automation flags
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-IN', 'en-US', 'en'],
    });
  });

  page = await context.newPage();

  log.success('Browser initialized');
  return { browser, context, page };
}

/**
 * Get existing browser instances
 */
function getBrowserInstances() {
  return { browser, context, page };
}

/**
 * Close browser gracefully
 */
async function closeBrowser() {
  try {
    if (page) {
      await page.close().catch(() => {});
      page = null;
    }
    if (context) {
      await context.close().catch(() => {});
      context = null;
    }
    if (browser) {
      await browser.close().catch(() => {});
      browser = null;
    }
    log.info('Browser closed gracefully');
  } catch (err) {
    log.error(`Error closing browser: ${err.message}`);
  }
}

/**
 * Take a debug screenshot
 */
async function takeDebugScreenshot(name) {
  try {
    if (page) {
      const fs = require('fs');
      const path = require('path');
      const debugDir = path.join(process.cwd(), 'debug');
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
      }
      const filepath = path.join(debugDir, `${name}_${Date.now()}.png`);
      await page.screenshot({ path: filepath, fullPage: true });
      log.info(`Debug screenshot saved: ${filepath}`);
      return filepath;
    }
  } catch (err) {
    log.error(`Failed to take screenshot: ${err.message}`);
  }
  return null;
}

module.exports = {
  initBrowser,
  getBrowserInstances,
  closeBrowser,
  takeDebugScreenshot,
};
