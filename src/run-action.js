#!/usr/bin/env node

/**
 * Run a single Naukri action without running the full bot.
 * Reuses an existing session if one is valid — only logs in if needed.
 *
 * Usage:
 *   npm run headline    →  update resume headline
 *   npm run summary     →  update profile summary
 *   npm run resume      →  upload resume
 *
 * Reads NAUKRI_EMAIL / NAUKRI_PASSWORD from .env for login fallback.
 */

require('dotenv').config();

const VALID_ACTIONS = ['headline', 'summary', 'resume'];

// Parse --action <value> from argv
const actionIdx = process.argv.indexOf('--action');
const action = actionIdx !== -1 ? process.argv[actionIdx + 1] : null;

if (!action || !VALID_ACTIONS.includes(action)) {
  console.error(`Usage: node src/run-action.js --action <${VALID_ACTIONS.join('|')}>`);
  process.exit(1);
}

const { createComponentLogger } = require('./utils/logger');
const { loadAppConfig, validateConfigFiles } = require('./utils/config');
const { initBrowser, closeBrowser, getBrowserInstances } = require('./browser/browserManager');
const { performLogin } = require('./auth/login');
const { loadSessionCookies, saveSessionCookies } = require('./auth/sessionManager');
const { validateLoggedIn } = require('./utils/validators');
const { executeHeadlineUpdate } = require('./automation/headlineUpdater');
const { executeSummaryUpdate } = require('./automation/summaryUpdater');
const { executeResumeUploadCycle } = require('./automation/resumeUploader');
const { randomDelay } = require('./automation/delays');

const log = createComponentLogger('RunAction');

/**
 * Ensure the browser has an active session.
 * Tries saved cookies first; falls back to fresh login.
 */
async function ensureLoggedIn(page, context) {
  const config = loadAppConfig();

  // Try loading saved session cookies
  const cookiesLoaded = await loadSessionCookies(context);

  if (cookiesLoaded) {
    log.info('Saved session found. Validating...');
    await page.goto(config.urls.profile, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await randomDelay(2000, 3000);

    const isLoggedIn = await validateLoggedIn(page);
    if (isLoggedIn) {
      log.success('Session is valid — skipping login');
      return true;
    }
    log.warn('Saved session expired. Logging in...');
  } else {
    log.info('No saved session. Logging in...');
  }

  // Fall back to fresh login using .env credentials
  const email = process.env.NAUKRI_EMAIL;
  const password = process.env.NAUKRI_PASSWORD;

  if (!email || !password) {
    log.error('NAUKRI_EMAIL and NAUKRI_PASSWORD must be set in .env');
    return false;
  }

  const success = await performLogin(page, email, password);
  if (success) {
    await saveSessionCookies(context);
  }
  return success;
}

async function run() {
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║   Naukri Bot — Run Action: ${action.padEnd(17)}║`);
  console.log(`╚══════════════════════════════════════════════╝\n`);

  if (!validateConfigFiles()) {
    log.error('Config files missing. Run "npm run setup" first.');
    process.exit(1);
  }

  const config = loadAppConfig();

  // Always run visible so you can see what's happening
  process.env.HEADLESS = 'false';
  const { context, page } = await initBrowser();

  try {
    // Ensure we're logged in (reuse session if valid)
    const loggedIn = await ensureLoggedIn(page, context);
    if (!loggedIn) {
      log.error('Could not establish session. Check credentials in .env');
      return;
    }

    // Run the requested action
    let success = false;
    switch (action) {
      case 'headline':
        success = await executeHeadlineUpdate(page);
        break;
      case 'summary':
        success = await executeSummaryUpdate(page);
        break;
      case 'resume':
        success = await executeResumeUploadCycle(page, config.resumePath);
        break;
    }

    console.log(`\n  Action "${action}": ${success ? '✅ OK' : '❌ FAILED'}\n`);
  } finally {
    await closeBrowser();
  }
}

run().catch((err) => {
  const { createComponentLogger } = require('./utils/logger');
  createComponentLogger('RunAction').error(`Crashed: ${err.message}`);
  closeBrowser().finally(() => process.exit(1));
});
