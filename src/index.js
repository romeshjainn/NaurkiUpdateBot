#!/usr/bin/env node

/**
 * Naukri Profile Automation Bot - Main Entry Point
 * 
 * Orchestrates:
 * 1. Authentication & session management
 * 2. Daily headline & summary rotation (9:00-12:00 IST)
 * 3. Daily resume re-upload (10:00-11:00 IST)
 * 4. Human-like behavior patterns throughout
 */

const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config();

const { createComponentLogger } = require('./utils/logger');
const { loadAppConfig, validateConfigFiles, credentialsExist } = require('./utils/config');
const { validateEnvVars, validateResumeFile } = require('./utils/validators');
const { initBrowser, closeBrowser, getBrowserInstances } = require('./browser/browserManager');
const { ensureSession, saveSessionCookies, validateSessionActive } = require('./auth/sessionManager');
const { executeHeadlineUpdate } = require('./automation/headlineUpdater');
const { executeSummaryUpdate } = require('./automation/summaryUpdater');
const { executeResumeUploadCycle } = require('./automation/resumeUploader');
const { randomDelay, getRandomTimeWindow, getDelayUntilNextWindow, randomInt } = require('./automation/delays');

const log = createComponentLogger('Main');

// Global state
let isRunning = false;
let isShuttingDown = false;
let scheduledTimers = [];

/**
 * Execute the headline + summary update job
 */
async function runProfileUpdateJob() {
  if (isShuttingDown) return;

  const { page, context } = getBrowserInstances();
  if (!page) {
    log.error('Browser not initialized. Cannot run profile update.');
    return;
  }

  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log.info('Starting Profile Update Job (Headline + Summary)');
  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    // Pre-action delay (appear human)
    await randomDelay(2000, 5000);

    // Validate session first
    const sessionValid = await validateSessionActive(page);
    if (!sessionValid) {
      log.warn('Session invalid. Refreshing...');
      const refreshed = await ensureSession(page, context);
      if (!refreshed) {
        log.error('Could not restore session. Skipping profile update.');
        return;
      }
    }

    // Execute headline update
    let headlineSuccess = false;
    try {
      headlineSuccess = await executeHeadlineUpdate(page);
    } catch (err) {
      log.error(`Headline update threw error: ${err.message}`);
      // Don't stop - continue to summary
    }

    // Delay between headline and summary (simulate reading/reviewing)
    await randomDelay(3000, 5000);

    // Execute summary update
    let summarySuccess = false;
    try {
      summarySuccess = await executeSummaryUpdate(page);
    } catch (err) {
      log.error(`Summary update threw error: ${err.message}`);
    }

    // Save session after successful operations
    if (headlineSuccess || summarySuccess) {
      await saveSessionCookies(context);
    }

    // Log results
    const status = headlineSuccess && summarySuccess ? '✅ ALL SUCCESS' :
                   headlineSuccess || summarySuccess ? '⚠️ PARTIAL SUCCESS' : '❌ FAILED';
    log.info(`Profile Update Job Result: ${status} (Headline: ${headlineSuccess}, Summary: ${summarySuccess})`);

  } catch (err) {
    log.error(`Profile update job error: ${err.message}`);
  }
}

/**
 * Execute the resume upload job
 */
async function runResumeUploadJob() {
  if (isShuttingDown) return;

  const config = loadAppConfig();
  const { page, context } = getBrowserInstances();
  if (!page) {
    log.error('Browser not initialized. Cannot run resume upload.');
    return;
  }

  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log.info('Starting Resume Upload Job');
  log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    // Pre-action delay
    await randomDelay(2000, 4000);

    // Validate session
    const sessionValid = await validateSessionActive(page);
    if (!sessionValid) {
      log.warn('Session invalid. Refreshing...');
      const refreshed = await ensureSession(page, context);
      if (!refreshed) {
        log.error('Could not restore session. Skipping resume upload.');
        return;
      }
    }

    // Execute resume upload cycle
    const success = await executeResumeUploadCycle(page, config.resumePath);

    if (success) {
      await saveSessionCookies(context);
    }

    log.info(`Resume Upload Job Result: ${success ? '✅ SUCCESS' : '❌ FAILED'}`);

  } catch (err) {
    log.error(`Resume upload job error: ${err.message}`);

    // Retry once after delay
    log.info('Retrying resume upload in 3 minutes...');
    await new Promise((r) => setTimeout(r, 3 * 60 * 1000));

    try {
      const success = await executeResumeUploadCycle(page, config.resumePath);
      log.info(`Resume Upload Retry Result: ${success ? '✅ SUCCESS' : '❌ FAILED'}`);
    } catch (retryErr) {
      log.error(`Resume upload retry failed: ${retryErr.message}`);
    }
  }
}

/**
 * Schedule today's jobs with random timing
 */
function scheduleTodaysJobs() {
  const config = loadAppConfig();

  // Clear any existing timers
  scheduledTimers.forEach((t) => clearTimeout(t));
  scheduledTimers = [];

  // Schedule profile update (headline + summary)
  const updateWindow = getRandomTimeWindow(config.updateWindowStart, config.updateWindowEnd);
  if (updateWindow) {
    const { delayMs, executionTime } = updateWindow;
    log.info(`Profile update scheduled at: ${executionTime.toLocaleTimeString('en-IN')} IST (in ${(delayMs / 60000).toFixed(1)} min)`);

    const timer1 = setTimeout(async () => {
      await runProfileUpdateJob();
    }, delayMs);
    scheduledTimers.push(timer1);
  } else {
    log.info('Profile update window has passed for today. Will schedule for tomorrow.');
  }

  // Schedule resume upload (separate window)
  const uploadWindow = getRandomTimeWindow(config.uploadWindowStart, config.uploadWindowEnd);
  if (uploadWindow) {
    let { delayMs, executionTime } = uploadWindow;

    // Ensure minimum gap between the two jobs
    if (updateWindow) {
      const gapMs = config.minGapBetweenJobsMinutes * 60 * 1000;
      const updateTime = updateWindow.delayMs;
      if (Math.abs(delayMs - updateTime) < gapMs) {
        delayMs = updateTime + gapMs + randomInt(0, 10 * 60 * 1000); // Add extra random gap
        const adjusted = new Date(Date.now() + delayMs);
        log.info(`Resume upload adjusted to maintain ${config.minGapBetweenJobsMinutes}min gap`);
        executionTime = adjusted;
      }
    }

    log.info(`Resume upload scheduled at: ${executionTime.toLocaleTimeString('en-IN')} IST (in ${(delayMs / 60000).toFixed(1)} min)`);

    const timer2 = setTimeout(async () => {
      await runResumeUploadJob();
    }, delayMs);
    scheduledTimers.push(timer2);
  } else {
    log.info('Resume upload window has passed for today. Will schedule for tomorrow.');
  }

  // Schedule next day's planning
  scheduleNextDay(config);
}

/**
 * Schedule the next day's job planning
 */
function scheduleNextDay(config) {
  const delayMs = getDelayUntilNextWindow(config.updateWindowStart);
  const nextDay = new Date(Date.now() + delayMs);

  log.info(`Next day's scheduling will happen at: ${nextDay.toLocaleString('en-IN')} IST (in ${(delayMs / 3600000).toFixed(1)} hours)`);

  const timer = setTimeout(() => {
    log.info('═══════════════════════════════════════════');
    log.info('New day! Scheduling today\'s jobs...');
    log.info('═══════════════════════════════════════════');
    scheduleTodaysJobs();
  }, delayMs);

  scheduledTimers.push(timer);
}

/**
 * Run all jobs immediately (for --run-once mode)
 */
async function runOnce() {
  log.info('Running all jobs once (immediate mode)...');

  // Vary the sequence randomly
  if (Math.random() < 0.5) {
    await runProfileUpdateJob();
    await randomDelay(5000, 15000); // 5-15s gap
    await runResumeUploadJob();
  } else {
    await runResumeUploadJob();
    await randomDelay(5000, 15000);
    await runProfileUpdateJob();
  }

  log.success('All jobs completed (run-once mode)');
}

/**
 * Graceful shutdown handler
 */
async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log.info(`\nReceived ${signal}. Shutting down gracefully...`);

  // Clear all scheduled timers
  scheduledTimers.forEach((t) => clearTimeout(t));
  scheduledTimers = [];

  // Close browser
  await closeBrowser();

  log.info('Bot shutdown complete. Goodbye!');
  process.exit(0);
}

/**
 * Main application entry
 */
async function main() {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║       Naukri Profile Automation Bot          ║');
  console.log('║              v1.0.0                          ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  const isRunOnce = process.argv.includes('--run-once');

  try {
    // ── INITIALIZATION PHASE ──
    log.info('Phase 1: Initialization');

    // Validate config files exist
    if (!validateConfigFiles()) {
      log.fatal('Config validation failed. Run "npm run setup" first.');
      process.exit(1);
    }

    // Validate environment
    if (!validateEnvVars()) {
      log.fatal('Environment validation failed. Run "npm run setup" first.');
      process.exit(1);
    }

    // Check credentials
    if (!credentialsExist()) {
      log.fatal('No credentials found. Run "npm run setup" first.');
      process.exit(1);
    }

    // Validate resume file
    const config = loadAppConfig();
    validateResumeFile(config.resumePath);

    log.success('Initialization complete');

    // ── AUTHENTICATION PHASE ──
    log.info('Phase 2: Authentication');

    const { browser, context, page } = await initBrowser();

    // Ensure we have a valid session
    const sessionReady = await ensureSession(page, context);
    if (!sessionReady) {
      log.fatal('Could not establish authenticated session. Please run "npm run setup" and verify credentials.');
      await closeBrowser();
      process.exit(1);
    }

    log.success('Authentication complete - session active');

    // ── EXECUTION PHASE ──
    if (isRunOnce) {
      // Single run mode
      log.info('Phase 3: Executing jobs (run-once mode)');
      await runOnce();
      await closeBrowser();
      process.exit(0);
    }

    // ── SCHEDULING PHASE (continuous mode) ──
    log.info('Phase 3: Scheduling daily jobs');
    isRunning = true;
    scheduleTodaysJobs();

    log.success('Bot is running! Waiting for scheduled jobs...');
    log.info('Press Ctrl+C to stop.\n');

    // ── GRACEFUL SHUTDOWN HANDLERS ──
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('uncaughtException', (err) => {
      log.error(`Uncaught exception: ${err.message}`);
      log.error(err.stack);
      // Don't exit - try to keep running
    });
    process.on('unhandledRejection', (reason) => {
      log.error(`Unhandled rejection: ${reason}`);
      // Don't exit - try to keep running
    });

    // Keep process alive
    setInterval(() => {
      // Heartbeat log every 6 hours
    }, 6 * 60 * 60 * 1000);

  } catch (err) {
    log.fatal(`Application error: ${err.message}`);
    log.error(err.stack);
    await closeBrowser();
    process.exit(1);
  }
}

// Run the application
main();
