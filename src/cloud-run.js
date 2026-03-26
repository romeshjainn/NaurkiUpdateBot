#!/usr/bin/env node

/**
 * Cloud Run — Daily bot entry point for Google Cloud / cron.
 *
 * Trigger via system cron at 9:00 AM IST (3:30 AM UTC) every day:
 *   30 3 * * * cd /path/to/bot && node src/cloud-run.js >> logs/cron.log 2>&1
 *
 * What happens each run:
 *   1. Picks a random sleep between 0–3 hours (so actual execution is random within 9–12 IST)
 *   2. Decides WHICH text actions to run today (randomly):
 *        ~33%  → only headline
 *        ~33%  → only summary
 *        ~34%  → both headline AND summary
 *   3. Resume upload is ALWAYS included
 *   4. Shuffles the order of the selected actions
 *   5. Executes them, sends an email per action
 *   6. Exits
 *
 * The bot never runs the exact same combo in the same order two days in a row.
 */

require('dotenv').config();

const { createComponentLogger } = require('./utils/logger');
const { loadAppConfig, validateConfigFiles } = require('./utils/config');
const { initBrowser, closeBrowser } = require('./browser/browserManager');
const { performLogin } = require('./auth/login');
const { loadSessionCookies, saveSessionCookies } = require('./auth/sessionManager');
const { validateLoggedIn } = require('./utils/validators');
const { executeHeadlineUpdate } = require('./automation/headlineUpdater');
const { executeSummaryUpdate } = require('./automation/summaryUpdater');
const { executeResumeUploadCycle } = require('./automation/resumeUploader');
const { sendNotification } = require('./utils/mailer');
const { randomDelay } = require('./automation/delays');

const log = createComponentLogger('CloudRun');

// ─── Randomisation ────────────────────────────────────────────────────────────

/**
 * Pick which text actions to run today.
 * Resume is always included separately.
 * Returns a shuffled array, e.g. ['summary', 'resume'] or ['headline', 'summary', 'resume']
 */
function pickTodaysActions() {
  const r = Math.random();
  let textActions;
  if (r < 0.33) {
    textActions = ['headline'];
  } else if (r < 0.66) {
    textActions = ['summary'];
  } else {
    textActions = ['headline', 'summary'];
  }

  // Resume always runs — shuffle it into a random position
  const all = [...textActions, 'resume'];
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }

  return all;
}

/**
 * Random sleep between 0 and 3 hours (the 9–12 IST window).
 * Cron fires at 9:00 IST, we sleep up to 3h so we run at a random time each day.
 */
async function randomWindowSleep() {
  const maxMs = 3 * 60 * 60 * 1000; // 3 hours
  const sleepMs = Math.floor(Math.random() * maxMs);
  const mins = Math.round(sleepMs / 60000);
  const runAt = new Date(Date.now() + sleepMs).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit',
  });
  log.info(`Random sleep: ${mins} min — will execute at ~${runAt} IST`);
  await new Promise((r) => setTimeout(r, sleepMs));
}

// ─── Session ──────────────────────────────────────────────────────────────────

async function ensureLoggedIn(page, context) {
  const config = loadAppConfig();
  const cookiesLoaded = await loadSessionCookies(context);

  if (cookiesLoaded) {
    await page.goto(config.urls.profile, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await randomDelay(2000, 3000);
    if (await validateLoggedIn(page)) {
      log.success('Existing session valid — skipping login');
      return true;
    }
    log.warn('Session expired. Logging in fresh...');
  }

  const email = process.env.NAUKRI_EMAIL;
  const password = process.env.NAUKRI_PASSWORD;
  if (!email || !password) {
    log.error('NAUKRI_EMAIL / NAUKRI_PASSWORD not set in .env');
    return false;
  }

  const ok = await performLogin(page, email, password);
  if (ok) await saveSessionCookies(context);
  return ok;
}

// ─── Action runner ────────────────────────────────────────────────────────────

async function runAction(page, action, config) {
  switch (action) {
    case 'headline': return executeHeadlineUpdate(page);
    case 'summary':  return executeSummaryUpdate(page);
    case 'resume':   return executeResumeUploadCycle(page, config.resumePath);
    default:         return false;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const startedAt = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  log.info(`=== Cloud Run started at ${startedAt} IST ===`);

  if (!validateConfigFiles()) {
    log.error('Config files missing. Run "npm run setup" first.');
    process.exit(1);
  }

  // Random sleep within the 9–12 IST window
  await randomWindowSleep();

  const config = loadAppConfig();

  // Always run headless on cloud
  process.env.HEADLESS = 'true';

  const { context, page } = await initBrowser();

  try {
    // Auth
    const loggedIn = await ensureLoggedIn(page, context);
    if (!loggedIn) {
      log.error('Login failed. Aborting.');
      await sendNotification('❌ Naukri Bot — Login Failed', 'Could not log in. Check credentials.');
      return;
    }

    // Decide today's actions and order
    const actions = pickTodaysActions();
    log.info(`Today's plan: [${actions.join(' → ')}]`);

    const results = {};
    for (const action of actions) {
      log.info(`── Running: ${action} ──`);
      try {
        results[action] = await runAction(page, action, config);
      } catch (err) {
        log.error(`Action "${action}" threw: ${err.message}`);
        results[action] = false;
      }
      // Random gap between actions (30–90 seconds) — looks human
      if (actions.indexOf(action) < actions.length - 1) {
        const gap = 30000 + Math.random() * 60000;
        log.info(`Waiting ${Math.round(gap / 1000)}s before next action...`);
        await new Promise((r) => setTimeout(r, gap));
      }
    }

    // Summary email
    const lines = Object.entries(results)
      .map(([a, ok]) => `  ${ok ? '✅' : '❌'} ${a}`)
      .join('\n');
    const allOk = Object.values(results).every(Boolean);
    const subject = allOk ? '✅ Naukri Bot — Daily Run Complete' : '⚠️ Naukri Bot — Daily Run (partial)';
    await sendNotification(subject,
      `Daily run finished.\n\nActions run: ${actions.join(' → ')}\n\nResults:\n${lines}`
    );

    log.info(`Daily run complete. Results: ${JSON.stringify(results)}`);
  } finally {
    await closeBrowser();
  }
}

main().catch(async (err) => {
  log.error(`Cloud run crashed: ${err.message}`);
  await sendNotification('❌ Naukri Bot — Crashed', `Error: ${err.message}\n\n${err.stack}`).catch(() => {});
  await closeBrowser().catch(() => {});
  process.exit(1);
});
