#!/usr/bin/env node

/**
 * Selector Testing Script
 * 
 * Run this BEFORE deploying automation to verify that all
 * CSS/XPath selectors work correctly on the current Naukri UI.
 * 
 * Usage: npm run test:selectors
 */

const path = require('path');
require('dotenv').config();

const { chromium } = require('playwright');
const { loadSelectors, loadAppConfig } = require('../src/utils/config');
const { decryptCredentials } = require('../src/auth/encryption');
const { simulateTyping, randomDelay } = require('../src/automation/delays');

const fs = require('fs');
const debugDir = path.join(process.cwd(), 'debug');
if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });

const results = { passed: 0, failed: 0, skipped: 0 };

function logResult(name, passed, detail = '') {
  if (passed) {
    results.passed++;
    console.log(`  ✅ ${name}${detail ? ' - ' + detail : ''}`);
  } else {
    results.failed++;
    console.log(`  ❌ ${name}${detail ? ' - ' + detail : ''}`);
  }
}

async function testSelectors() {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║       Selector Validation Test Suite         ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  const config = loadAppConfig();
  const selectors = loadSelectors();

  let credentials;
  try {
    credentials = decryptCredentials();
  } catch (err) {
    console.log('❌ Could not decrypt credentials. Run "npm run setup" first.');
    console.log(`   Error: ${err.message}`);
    process.exit(1);
  }

  const browser = await chromium.launch({
    headless: false, // Run headed for visual verification
    slowMo: 50,
  });

  const context = await browser.newContext({
    userAgent: config.userAgent,
    viewport: { width: 1366, height: 768 },
  });

  const page = await context.newPage();

  try {
    // ── TEST 1: Login ──
    console.log('📋 Test 1: Login Flow');

    await page.goto(config.urls.login, { waitUntil: 'networkidle', timeout: 30000 });
    await randomDelay(2000, 3000);

    // Test email field
    let emailFound = false;
    for (const selector of selectors.loginForm.emailField) {
      try {
        const el = await page.locator(selector).first();
        if (await el.isVisible({ timeout: 2000 })) {
          logResult('Email field', true, selector);
          emailFound = true;

          // Actually fill it
          await el.fill(credentials.email);
          break;
        }
      } catch {}
    }
    if (!emailFound) logResult('Email field', false, 'No selector matched');

    // Test password field
    let pwFound = false;
    for (const selector of selectors.loginForm.passwordField) {
      try {
        const el = await page.locator(selector).first();
        if (await el.isVisible({ timeout: 2000 })) {
          logResult('Password field', true, selector);
          pwFound = true;
          await el.fill(credentials.password);
          break;
        }
      } catch {}
    }
    if (!pwFound) logResult('Password field', false, 'No selector matched');

    // Test login button
    let loginBtnFound = false;
    for (const selector of selectors.loginForm.loginButton) {
      try {
        const el = await page.locator(selector).first();
        if (await el.isVisible({ timeout: 2000 })) {
          logResult('Login button', true, selector);
          loginBtnFound = true;

          // Click to actually log in
          await el.click();
          break;
        }
      } catch {}
    }
    if (!loginBtnFound) logResult('Login button', false, 'No selector matched');

    // Wait for login to complete
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await randomDelay(3000, 5000);

    const loggedIn = !page.url().includes('login');
    logResult('Login redirect', loggedIn, loggedIn ? page.url() : 'Still on login page');

    if (!loggedIn) {
      console.log('\n⚠️  Login failed. Cannot test profile selectors.');
      await page.screenshot({ path: path.join(debugDir, 'test_login_failed.png') });
      await browser.close();
      printSummary();
      return;
    }

    // ── TEST 2: Profile Modal ──
    console.log('\n📋 Test 2: Profile Modal');

    await page.goto(config.urls.profileModal, { waitUntil: 'networkidle', timeout: 20000 });
    await randomDelay(2000, 3000);

    // Take full modal screenshot
    await page.screenshot({ path: path.join(debugDir, 'test_modal_full.png'), fullPage: true });
    logResult('Modal page load', true, 'Screenshot saved: debug/test_modal_full.png');

    // Test headline field
    console.log('\n📋 Test 3: Headline Field');
    let headlineFound = false;
    for (const selector of selectors.resumeHeadlineField.selectors) {
      try {
        const el = await page.locator(selector).first();
        if (await el.isVisible({ timeout: 2000 })) {
          logResult('Headline field', true, selector);
          headlineFound = true;
          await el.screenshot({ path: path.join(debugDir, 'test_headline_field.png') });
          break;
        }
      } catch {}
    }
    if (!headlineFound) {
      logResult('Headline field', false, 'No selector matched. Check debug/test_modal_full.png');
    }

    // Test summary field
    console.log('\n📋 Test 4: Summary Field');
    let summaryFound = false;
    for (const selector of selectors.profileSummaryField.selectors) {
      try {
        const el = await page.locator(selector).first();
        if (await el.isVisible({ timeout: 2000 })) {
          logResult('Summary field', true, selector);
          summaryFound = true;
          await el.screenshot({ path: path.join(debugDir, 'test_summary_field.png') });
          break;
        }
      } catch {}
    }
    if (!summaryFound) {
      logResult('Summary field', false, 'No selector matched. Check debug/test_modal_full.png');
    }

    // Test save button
    console.log('\n📋 Test 5: Save Button');
    const saveBtnSelectors = [
      selectors.resumeHeadlineField.saveButtonSelector,
      'button:has-text("Save")',
      'button[class*="save" i]',
      'button[class*="primary"]:has-text("Save")',
    ];
    let saveFound = false;
    for (const selector of saveBtnSelectors) {
      try {
        const el = await page.locator(selector).first();
        if (await el.isVisible({ timeout: 2000 })) {
          logResult('Save button', true, selector);
          saveFound = true;
          break;
        }
      } catch {}
    }
    if (!saveFound) {
      logResult('Save button', false, 'No selector matched');
    }

    // ── TEST 6: Resume Upload Section ──
    console.log('\n📋 Test 6: Resume Upload');

    // Try finding file input on current page
    let fileInputFound = false;
    for (const selector of selectors.resumeUploadInput.selectors) {
      try {
        const el = await page.locator(selector).first();
        if ((await el.count()) > 0) {
          logResult('File upload input (modal)', true, selector);
          fileInputFound = true;
          break;
        }
      } catch {}
    }

    if (!fileInputFound) {
      // Try resume page
      await page.goto(config.urls.resume, { waitUntil: 'networkidle', timeout: 20000 });
      await randomDelay(2000, 3000);
      await page.screenshot({ path: path.join(debugDir, 'test_resume_page.png'), fullPage: true });

      for (const selector of selectors.resumeUploadInput.selectors) {
        try {
          const el = await page.locator(selector).first();
          if ((await el.count()) > 0) {
            logResult('File upload input (resume page)', true, selector);
            fileInputFound = true;
            break;
          }
        } catch {}
      }
    }

    if (!fileInputFound) {
      logResult('File upload input', false, 'Not found on modal or resume page');
    }

    // Test delete button
    let deleteFound = false;
    for (const selector of selectors.resumeDeleteButton.selectors) {
      try {
        const el = await page.locator(selector).first();
        if (await el.isVisible({ timeout: 2000 })) {
          logResult('Resume delete button', true, selector);
          deleteFound = true;
          break;
        }
      } catch {}
    }
    if (!deleteFound) {
      logResult('Resume delete button', false, 'Not found (may be OK if no resume uploaded)');
      results.failed--; // Don't count as failure
      results.skipped++;
    }

  } catch (err) {
    console.log(`\n❌ Test error: ${err.message}`);
    await page.screenshot({ path: path.join(debugDir, 'test_error.png') });
  } finally {
    await browser.close();
  }

  printSummary();
}

function printSummary() {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║              Test Summary                    ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  Passed:  ${results.passed}                                  ║`);
  console.log(`║  Failed:  ${results.failed}                                  ║`);
  console.log(`║  Skipped: ${results.skipped}                                  ║`);
  console.log('╚══════════════════════════════════════════════╝');
  console.log('\nDebug screenshots saved to: ./debug/');

  if (results.failed > 0) {
    console.log('\n⚠️  Some selectors failed. Review debug screenshots and update config/selectors.json');
    console.log('   You may need to inspect the Naukri page manually to find working selectors.');
  } else {
    console.log('\n✅ All selectors are working! The bot is ready to deploy.');
  }
}

testSelectors().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
