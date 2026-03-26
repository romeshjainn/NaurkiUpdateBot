const { chromium } = require('playwright');
const { createComponentLogger } = require('../utils/logger');
const { loadAppConfig } = require('../utils/config');

const log = createComponentLogger('Browser');

let browser = null;
let context = null;
let page = null;

/**
 * Initialize Playwright browser with human-like settings
 */
async function initBrowser() {
  const config = loadAppConfig();

  log.info(`Launching browser (headless: ${config.headless})...`);

  browser = await chromium.launch({
    headless: config.headless,
    slowMo: config.slowMotion,
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
