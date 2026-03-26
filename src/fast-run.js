#!/usr/bin/env node

/**
 * Fast test run — executes every action once with a 3-second gap between each.
 * Reads Naukri credentials directly from .env (NAUKRI_EMAIL / NAUKRI_PASSWORD).
 * Runs the browser in visible (non-headless) mode so you can watch what happens.
 *
 * Usage:
 *   npm run fast
 */

require('dotenv').config();

const { createComponentLogger } = require('./utils/logger');
const { loadAppConfig, validateConfigFiles } = require('./utils/config');
const { validateResumeFile } = require('./utils/validators');
const { initBrowser, closeBrowser, getBrowserInstances } = require('./browser/browserManager');
const { performLogin } = require('./auth/login');
const { saveSessionCookies } = require('./auth/sessionManager');
const { executeHeadlineUpdate } = require('./automation/headlineUpdater');
const { executeSummaryUpdate } = require('./automation/summaryUpdater');
const { executeResumeUploadCycle } = require('./automation/resumeUploader');

const log = createComponentLogger('FastRun');

const STEP_DELAY_MS = 3000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║        Naukri Bot — Fast Test Run            ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  // ── Credentials from .env ──
  const email = process.env.NAUKRI_EMAIL;
  const password = process.env.NAUKRI_PASSWORD;

  if (!email || !password) {
    log.error('NAUKRI_EMAIL and NAUKRI_PASSWORD must be set in your .env file.');
    log.error('Add them to .env and re-run.');
    process.exit(1);
  }

  // ── Config & file validation ──
  if (!validateConfigFiles()) {
    log.error('Config files missing. Run "npm run setup" first.');
    process.exit(1);
  }

  const config = loadAppConfig();
  validateResumeFile(config.resumePath);

  // ── Launch browser in visible mode ──
  log.info('Launching browser (visible mode)...');
  // Force headless off so you can watch
  process.env.HEADLESS = 'false';
  const { context, page } = await initBrowser();

  try {
    // ── Step 1: Login ──
    log.info('━━━ Step 1 / 4 : Login ━━━');
    const loggedIn = await performLogin(page, email, password);
    if (!loggedIn) {
      log.error('Login failed. Check credentials or debug screenshots in ./debug/');
      return;
    }
    await saveSessionCookies(context);
    log.success('Login OK');

    await sleep(STEP_DELAY_MS);

    // ── Step 2: Headline update ──
    log.info('━━━ Step 2 / 4 : Headline Update ━━━');
    const headlineOk = await executeHeadlineUpdate(page);
    log.info(`Headline update: ${headlineOk ? 'OK' : 'FAILED'}`);

    await sleep(STEP_DELAY_MS);

    // ── Step 3: Summary update ──
    log.info('━━━ Step 3 / 4 : Summary Update ━━━');
    const summaryOk = await executeSummaryUpdate(page);
    log.info(`Summary update: ${summaryOk ? 'OK' : 'FAILED'}`);

    await sleep(STEP_DELAY_MS);

    // ── Step 4: Resume upload ──
    log.info('━━━ Step 4 / 4 : Resume Upload ━━━');
    const resumeOk = await executeResumeUploadCycle(page, config.resumePath);
    log.info(`Resume upload: ${resumeOk ? 'OK' : 'FAILED'}`);

    // ── Summary ──
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║                  Results                     ║');
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║  Login         : ${loggedIn  ? '✅ OK    ' : '❌ FAILED'}                       ║`);
    console.log(`║  Headline      : ${headlineOk ? '✅ OK    ' : '❌ FAILED'}                       ║`);
    console.log(`║  Summary       : ${summaryOk  ? '✅ OK    ' : '❌ FAILED'}                       ║`);
    console.log(`║  Resume Upload : ${resumeOk   ? '✅ OK    ' : '❌ FAILED'}                       ║`);
    console.log('╚══════════════════════════════════════════════╝\n');

  } finally {
    await closeBrowser();
  }
}

run().catch((err) => {
  log.error(`Fast run crashed: ${err.message}`);
  log.error(err.stack);
  closeBrowser().finally(() => process.exit(1));
});
