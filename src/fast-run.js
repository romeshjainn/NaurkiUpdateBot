#!/usr/bin/env node

/**
 * Fast run — generates fresh resume/headline/summary via AI then immediately
 * uploads resume + updates a randomly chosen profile field set.
 *
 * Flow:
 *   1. Login (reuse saved session if valid)
 *   2. Delete stale generated resume
 *   3. Scrape existing headline + summary from Naukri
 *   4. Generate: AI-improved resume PDF + optimized headline + summary (2 Groq calls)
 *   5. Upload resume instantly
 *   6. Wait 10–30 s, then update profile based on today's action:
 *        33% → headline only
 *        33% → summary only
 *        33% → both headline + summary
 *      (same action cannot repeat on consecutive days)
 *   7. Save today's action to config/update_history.json, delete yesterday's record
 *   8. Exit
 *
 * Usage:
 *   npm run fast
 */

require('dotenv').config();

const fs   = require('fs');
const path = require('path');

const { createComponentLogger }                    = require('./utils/logger');
const { loadAppConfig, validateConfigFiles, loadSelectors } = require('./utils/config');
const { validateResumeFile, validateLoggedIn }     = require('./utils/validators');
const { initBrowser, closeBrowser }                = require('./browser/browserManager');
const { performLogin }                             = require('./auth/login');
const { loadSessionCookies, saveSessionCookies }   = require('./auth/sessionManager');
const { generateResume }                           = require('./resume_generator/generateResume');
const { updateHeadlineOnProfile }                  = require('./automation/headlineUpdater');
const { updateSummaryOnProfile }                   = require('./automation/summaryUpdater');
const { executeResumeUploadCycle }                 = require('./automation/resumeUploader');
const { randomDelay }                              = require('./automation/delays');
const { sendRunSummary }                           = require('./utils/mailer');

const log = createComponentLogger('FastRun');

const HISTORY_FILE    = path.join(process.cwd(), 'config', 'update_history.json');
const GENERATED_DIR   = path.join(__dirname, 'resume_generator', 'resume');
const ALL_ACTIONS     = ['headline', 'summary', 'both'];

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Pick today's profile action (headline / summary / both).
 * The same action cannot repeat on two consecutive days.
 */
function pickTodaysAction() {
  let lastAction = null;

  if (fs.existsSync(HISTORY_FILE)) {
    try {
      const rec = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      if (rec.date === yesterdayStr()) lastAction = rec.action;
    } catch { /* corrupt file — ignore */ }
  }

  const pool = lastAction
    ? ALL_ACTIONS.filter((a) => a !== lastAction)
    : ALL_ACTIONS;

  const chosen = pool[Math.floor(Math.random() * pool.length)];
  log.info(`Today's action: ${chosen.toUpperCase()}${lastAction ? ` (yesterday was ${lastAction})` : ''}`);
  return chosen;
}

/**
 * Persist today's action; replaces any previous record.
 */
function saveTodaysAction(action) {
  fs.writeFileSync(
    HISTORY_FILE,
    JSON.stringify({ date: todayStr(), action }, null, 2),
    'utf8'
  );
  log.info(`Update history saved → ${todayStr()}: ${action}`);
}

/**
 * Delete all files inside the generated resume output directory so we always
 * start fresh.
 */
function clearGeneratedResume() {
  if (!fs.existsSync(GENERATED_DIR)) return;
  for (const f of fs.readdirSync(GENERATED_DIR)) {
    try {
      fs.unlinkSync(path.join(GENERATED_DIR, f));
    } catch { /* ignore */ }
  }
  log.info('Cleared stale generated resume files');
}

/**
 * Scrape the current headline and summary text from the Naukri profile page.
 * Returns empty strings if selectors don't match — graceful fallback.
 */
async function scrapeProfileContent(page) {
  const config    = loadAppConfig();
  const selectors = loadSelectors();
  const { headlineSelectors, summarySelectors } = selectors.profileContentRead;

  log.info('Scraping existing headline & summary from profile...');
  await page.goto(config.urls.profile, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await randomDelay(2000, 3000);

  async function readText(selectorList) {
    for (const sel of selectorList) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 2000 })) {
          const text = (await el.inputValue().catch(() => null))
                    || (await el.innerText().catch(() => null))
                    || '';
          if (text.trim()) return text.trim();
        }
      } catch { /* try next */ }
    }
    return '';
  }

  const existingHeadline = await readText(headlineSelectors);
  const existingSummary  = await readText(summarySelectors);

  log.info(existingHeadline
    ? `Headline scraped: "${existingHeadline.substring(0, 80)}"`
    : 'Headline not scraped — will generate from resume alone');
  log.info(existingSummary
    ? `Summary scraped: "${existingSummary.substring(0, 80)}"`
    : 'Summary not scraped — will generate from resume alone');

  return { existingHeadline, existingSummary };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║        Naukri Bot — Fast Run                 ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  const email    = process.env.NAUKRI_EMAIL;
  const password = process.env.NAUKRI_PASSWORD;

  if (!email || !password) {
    log.error('NAUKRI_EMAIL and NAUKRI_PASSWORD must be set in .env');
    process.exit(1);
  }
  if (!validateConfigFiles()) {
    log.error('Config files missing. Run "npm run setup" first.');
    process.exit(1);
  }

  const config = loadAppConfig();
  validateResumeFile(config.resumePath);

  // Decide what to update today before launching browser
  const todayAction = pickTodaysAction();
  const doHeadline  = todayAction === 'headline' || todayAction === 'both';
  const doSummary   = todayAction === 'summary'  || todayAction === 'both';

  // Wipe stale generated files so we always compile fresh
  clearGeneratedResume();

  log.info(`Launching browser (headless: ${process.env.HEADLESS !== 'false'})...`);
  const { context, page } = await initBrowser();

  const runTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  let resumeUploadedAt  = null;
  let loggedIn          = false;
  let generateOk        = false;
  let resumeOk          = false;
  let headlineOk        = false;
  let summaryOk         = false;
  let generatedPdf      = null;
  let generatedHeadline = null;
  let generatedSummary  = null;
  let previousHeadline  = '';
  let previousSummary   = '';

  try {
    // ── 1. Login ───────────────────────────────────────────────────────────────
    log.info('━━━ Login ━━━');

    const cookiesLoaded = await loadSessionCookies(context);
    if (cookiesLoaded) {
      await page.goto(config.urls.profile, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await randomDelay(2000, 3000);
      loggedIn = await validateLoggedIn(page);
      if (loggedIn) log.success('Saved session valid — skipping login');
      else log.warn('Session expired — fresh login...');
    }

    if (!loggedIn) {
      loggedIn = await performLogin(page, email, password);
      if (!loggedIn) {
        log.error('Login failed. Check ./debug/ for screenshots.');
        return;
      }
      await saveSessionCookies(context);
    }
    log.success('Logged in');

    // ── 2. Scrape + Generate ───────────────────────────────────────────────────
    log.info('━━━ Scraping profile + AI generation ━━━');

    const { existingHeadline, existingSummary } = await scrapeProfileContent(page);
    previousHeadline = existingHeadline;
    previousSummary  = existingSummary;

    log.info('Running 2 Groq calls (resume bullets + headline/summary)...');
    try {
      const result = await generateResume({ existingHeadline, existingSummary });
      generatedPdf      = result.pdfPath;
      generatedHeadline = result.headline;
      generatedSummary  = result.summary;
      generateOk        = true;
      log.success('AI generation complete');
    } catch (err) {
      log.warn(`AI generation failed: ${err.message} — will fall back to existing resume.pdf`);
    }

    // ── 3. Upload resume instantly ─────────────────────────────────────────────
    log.info('━━━ Resume upload ━━━');
    resumeOk = await executeResumeUploadCycle(page, config.resumePath, {
      prePath: generatedPdf || undefined,
    });
    if (resumeOk) resumeUploadedAt = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    log.info(`Resume upload: ${resumeOk ? 'OK' : 'FAILED'}`);

    // ── 4. Wait 10–30 s then update headline/summary per today's action ────────
    const waitMs = Math.floor(Math.random() * (30000 - 10000 + 1)) + 10000;
    log.info(`Waiting ${(waitMs / 1000).toFixed(0)}s before profile update (action: ${todayAction})...`);
    await sleep(waitMs);

    if (doHeadline && generatedHeadline) {
      log.info('━━━ Headline update ━━━');
      headlineOk = await updateHeadlineOnProfile(page, generatedHeadline);
      log.info(`Headline: ${headlineOk ? 'OK' : 'FAILED'}`);
    } else if (doHeadline) {
      log.warn('Headline update skipped — no generated headline available');
    }

    if (doSummary && generatedSummary) {
      if (doHeadline) {
        // Small gap between the two if doing both
        const gap = Math.floor(Math.random() * (15000 - 5000 + 1)) + 5000;
        log.info(`Waiting ${(gap / 1000).toFixed(0)}s between headline and summary update...`);
        await sleep(gap);
      }
      log.info('━━━ Summary update ━━━');
      summaryOk = await updateSummaryOnProfile(page, generatedSummary);
      log.info(`Summary: ${summaryOk ? 'OK' : 'FAILED'}`);
    } else if (doSummary) {
      log.warn('Summary update skipped — no generated summary available');
    }

    // ── 5. Persist today's record ──────────────────────────────────────────────
    saveTodaysAction(todayAction);

    // ── 6. Send summary email ──────────────────────────────────────────────────
    const skipped = [];
    if (!doHeadline) skipped.push('Headline');
    if (!doSummary)  skipped.push('Summary');

    log.info('Sending run summary email...');
    await sendRunSummary({
      runTime,
      resumeUploadedAt: resumeUploadedAt || 'FAILED',
      resumeOk,
      pdfPath: generatedPdf,
      previousHeadline,
      newHeadline:      generatedHeadline || '',
      headlineDone:     headlineOk,
      previousSummary,
      newSummary:       generatedSummary || '',
      summaryDone:      summaryOk,
      todayAction,
      skipped,
    });

    // ── Summary table ──────────────────────────────────────────────────────────
    const skip = '⏭ SKIP ';
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║                  Results                     ║');
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║  Login         : ${loggedIn   ? '✅ OK    ' : '❌ FAILED'}                       ║`);
    console.log(`║  AI Generation : ${generateOk ? '✅ OK    ' : '⚠️ FAILED'}                       ║`);
    console.log(`║  Resume Upload : ${resumeOk   ? '✅ OK    ' : '❌ FAILED'}                       ║`);
    console.log(`║  Headline      : ${doHeadline ? (headlineOk ? '✅ OK    ' : '❌ FAILED') : skip}                       ║`);
    console.log(`║  Summary       : ${doSummary  ? (summaryOk  ? '✅ OK    ' : '❌ FAILED') : skip}                       ║`);
    console.log(`║  Today action  : ${todayAction.padEnd(9)}                              ║`);
    console.log('╚══════════════════════════════════════════════╝\n');

  } finally {
    await closeBrowser();
  }
}

run().catch((err) => {
  log.error(`Crashed: ${err.message}`);
  log.error(err.stack);
  closeBrowser().finally(() => process.exit(1));
});
