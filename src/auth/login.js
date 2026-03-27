const fs = require('fs');
const path = require('path');
const { createComponentLogger } = require('../utils/logger');
const { loadSelectors, loadAppConfig } = require('../utils/config');
const { randomDelay, simulateTyping } = require('../automation/delays');
const { fetchNaukriOTP } = require('./otpReader');

const log = createComponentLogger('Auth');

// Ensure debug dir exists
const DEBUG_DIR = path.join(process.cwd(), 'debug');
if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });

/**
 * Dump current page state to console + debug files.
 * Call this at any point login is misbehaving to get full visibility.
 *
 * Logs:
 *  - Current URL
 *  - All visible <input> elements (id, name, type, placeholder, class)
 *  - All visible <button> elements (text, type, class)
 *  - Any on-page error/alert text
 *
 * Saves:
 *  - debug/diag_<label>_<ts>.html  — full page HTML
 *  - debug/diag_<label>_<ts>.png   — screenshot
 */
async function dumpPageDiagnostics(page, label) {
  const ts = Date.now();
  const tag = `${label}_${ts}`;

  try {
    const url = page.url();
    log.info(`[DIAG:${label}] URL: ${url}`);

    // Collect all input elements
    const inputs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('input')).map((el) => ({
        id: el.id || '',
        name: el.name || '',
        type: el.type || '',
        placeholder: el.placeholder || '',
        className: el.className || '',
        visible: el.offsetParent !== null,
      }));
    });
    const visibleInputs = inputs.filter((i) => i.visible);
    if (visibleInputs.length === 0) {
      log.warn(`[DIAG:${label}] No visible inputs found on page`);
    } else {
      log.info(`[DIAG:${label}] Visible inputs (${visibleInputs.length}):`);
      visibleInputs.forEach((i) => {
        log.info(`  <input id="${i.id}" name="${i.name}" type="${i.type}" placeholder="${i.placeholder}" class="${i.className}">`);
      });
    }

    // Collect all button elements
    const buttons = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('button, input[type="submit"]')).map((el) => ({
        tag: el.tagName,
        type: el.type || '',
        text: el.innerText?.trim() || el.value || '',
        className: el.className || '',
        visible: el.offsetParent !== null,
      }));
    });
    const visibleButtons = buttons.filter((b) => b.visible);
    if (visibleButtons.length === 0) {
      log.warn(`[DIAG:${label}] No visible buttons found on page`);
    } else {
      log.info(`[DIAG:${label}] Visible buttons (${visibleButtons.length}):`);
      visibleButtons.forEach((b) => {
        log.info(`  <${b.tag.toLowerCase()} type="${b.type}" class="${b.className}"> "${b.text}"`);
      });
    }

    // Collect any error/alert text
    const errorText = await page.evaluate(() => {
      const selectors = [
        '[class*="error" i]', '[class*="erMsg" i]', '[class*="alert" i]',
        '[class*="invalid" i]', '[class*="warning" i]', '.alert-danger',
      ];
      const texts = [];
      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach((el) => {
          const t = el.innerText?.trim();
          if (t) texts.push(`${sel}: "${t}"`);
        });
      }
      return [...new Set(texts)];
    });
    if (errorText.length > 0) {
      log.error(`[DIAG:${label}] Error/alert text found on page:`);
      errorText.forEach((t) => log.error(`  ${t}`));
    }

    // Save HTML snapshot
    const html = await page.content();
    const htmlPath = path.join(DEBUG_DIR, `diag_${tag}.html`);
    fs.writeFileSync(htmlPath, html, 'utf8');
    log.info(`[DIAG:${label}] HTML snapshot: debug/diag_${tag}.html`);

    // Save screenshot
    const imgPath = path.join(DEBUG_DIR, `diag_${tag}.png`);
    await page.screenshot({ path: imgPath, fullPage: true });
    log.info(`[DIAG:${label}] Screenshot: debug/diag_${tag}.png`);

  } catch (err) {
    log.warn(`[DIAG:${label}] Diagnostics failed: ${err.message}`);
  }
}

/**
 * Perform login on Naukri using credentials.
 * Navigates to the home page, triggers the login form, then fills credentials.
 * @param {object} page - Playwright page
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {boolean} Login success
 */
async function performLogin(page, email, password) {
  const config = loadAppConfig();
  const selectors = loadSelectors();

  log.info('Starting login process...');

  try {
    // Go directly to the login page
    await page.goto(config.urls.login, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(2000, 3000);

    // Dump page state immediately after load so we know exactly what's on screen
    await dumpPageDiagnostics(page, 'after_page_load');

    let emailField = await findLoginEmailField(page, selectors);

    if (!emailField) {
      log.error('Could not locate email input field. Tried selectors: ' + selectors.loginForm.emailField.join(' | '));
      await dumpPageDiagnostics(page, 'email_field_not_found');
      throw new Error('Could not locate email input field. See debug/diag_email_field_not_found_*.html');
    }

    log.info('Email field located. Typing email...');
    await emailField.click();
    await randomDelay(300, 600);
    await emailField.fill('');
    await simulateTyping(page, emailField, email);
    await randomDelay(500, 1000);

    // Find password field
    let passwordField = null;
    for (const selector of selectors.loginForm.passwordField) {
      try {
        const el = page.locator(selector).first();
        if (await el.isVisible({ timeout: 2000 })) {
          passwordField = el;
          log.info(`Password field found via: ${selector}`);
          break;
        }
      } catch {
        // try next
      }
    }

    if (!passwordField) {
      log.error('Could not locate password field. Tried selectors: ' + selectors.loginForm.passwordField.join(' | '));
      await dumpPageDiagnostics(page, 'password_field_not_found');
      throw new Error('Could not locate password input field. See debug/diag_password_field_not_found_*.html');
    }

    await passwordField.click();
    await randomDelay(300, 600);
    await passwordField.fill('');
    await simulateTyping(page, passwordField, password);
    await randomDelay(800, 1500);

    // Find and click login button
    let loginButton = null;
    for (const selector of selectors.loginForm.loginButton) {
      try {
        const el = page.locator(selector).first();
        if (await el.isVisible({ timeout: 2000 })) {
          loginButton = el;
          log.info(`Login button found via: ${selector}`);
          break;
        }
      } catch {
        // try next
      }
    }

    if (!loginButton) {
      log.error('Could not locate login button. Tried selectors: ' + selectors.loginForm.loginButton.join(' | '));
      await dumpPageDiagnostics(page, 'login_button_not_found');
      throw new Error('Could not locate login button. See debug/diag_login_button_not_found_*.html');
    }

    await randomDelay(500, 1000);
    await loginButton.click();

    log.info('Login button clicked. Waiting for response...');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await randomDelay(2000, 3000);

    // Dump state immediately after submit — reveals OTP screen, error, redirect, etc.
    await dumpPageDiagnostics(page, 'after_submit');

    // Handle OTP screen if Naukri asks for verification
    const otpHandled = await handleOTPIfPresent(page);
    if (otpHandled === false) {
      await dumpPageDiagnostics(page, 'otp_failed');
      return false;
    }

    await randomDelay(2000, 3000);

    // Check success: should no longer be on the login page
    const currentUrl = page.url();
    log.info(`Post-login URL: ${currentUrl}`);

    if (currentUrl.includes('nlogin') || currentUrl.includes('/login')) {
      log.error('Still on login page after submitting. Dumping full page state...');
      await dumpPageDiagnostics(page, 'still_on_login');
      return false;
    }

    log.success('Login successful!');
    return true;
  } catch (err) {
    log.error(`Login error: ${err.message}`);
    try {
      await dumpPageDiagnostics(page, 'exception');
    } catch {
      // diagnostics also failed
    }
    return false;
  }
}

/**
 * Try each login nav trigger selector until one is clickable.
 * Returns true if a trigger was found and clicked.
 */
async function clickLoginTrigger(page, selectors) {
  for (const selector of selectors.loginNavTrigger.selectors) {
    try {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 2000 })) {
        await el.click();
        log.debug(`Login trigger clicked: ${selector}`);
        return true;
      }
    } catch {
      // try next
    }
  }
  return false;
}

/**
 * Try each email field selector and return the first visible element, or null.
 */
async function findLoginEmailField(page, selectors) {
  for (const selector of selectors.loginForm.emailField) {
    try {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 1500 })) {
        log.debug(`Email field found: ${selector}`);
        return el;
      }
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Detect OTP screen and fill it automatically from Gmail.
 * Handles two layouts Naukri uses:
 *   1. Split — six individual tel inputs (Input_1 … Input_6), one digit each
 *   2. Single — one input for the full 6-digit code
 * Selectors are loaded from config/selectors.json (otpForm section).
 * Returns true if no OTP needed or OTP succeeded, false if failed.
 */
async function handleOTPIfPresent(page) {
  const selectors = loadSelectors();

  try {
    // ── Detect OTP screen ──────────────────────────────────────────────────

    // Check for split OTP (6 individual boxes) — this is what Naukri currently shows
    let isSplitOtp = false;
    for (const sel of selectors.otpForm.splitOtpFirstField) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 3000 })) {
          isSplitOtp = true;
          log.info(`OTP screen detected — split layout (first field: ${sel})`);
          break;
        }
      } catch { /* try next */ }
    }

    // Fallback: check for single OTP field
    let singleOtpField = null;
    if (!isSplitOtp) {
      for (const sel of selectors.otpForm.otpField) {
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 2000 })) {
            singleOtpField = el;
            log.info(`OTP screen detected — single field layout (${sel})`);
            break;
          }
        } catch { /* try next */ }
      }
    }

    if (!isSplitOtp && !singleOtpField) return true; // no OTP screen, all good

    // ── Fetch OTP from Gmail ───────────────────────────────────────────────

    const email = process.env.NAUKRI_EMAIL;
    const appPass = process.env.NAUKRI_EMAIL_APP_PASS;
    if (!appPass) {
      log.error('OTP screen detected but NAUKRI_EMAIL_APP_PASS not set in .env');
      return false;
    }

    log.info('Fetching OTP from Gmail...');
    const otp = await fetchNaukriOTP(email, appPass);
    if (!otp) {
      log.error('Could not retrieve OTP from Gmail');
      return false;
    }
    log.info(`OTP retrieved: ${otp}`);

    // ── Fill OTP ───────────────────────────────────────────────────────────

    if (isSplitOtp) {
      // Type one digit into each box
      const digits = otp.split('');
      for (let i = 0; i < selectors.otpForm.splitOtpAllFields.length; i++) {
        const digit = digits[i];
        if (!digit) break;
        const sel = selectors.otpForm.splitOtpAllFields[i];
        try {
          const el = page.locator(sel).first();
          await el.click();
          await randomDelay(100, 200);
          await el.fill(digit);
          await randomDelay(80, 150);
          log.info(`Filled box ${i + 1} (${sel}) with digit "${digit}"`);
        } catch (err) {
          log.error(`Failed to fill OTP box ${i + 1} (${sel}): ${err.message}`);
          return false;
        }
      }
    } else {
      // Single field — type the full code
      await singleOtpField.click();
      await randomDelay(300, 600);
      await simulateTyping(page, singleOtpField, otp);
    }

    await randomDelay(500, 1000);

    // ── Submit ─────────────────────────────────────────────────────────────

    for (const sel of selectors.otpForm.submitButton) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 2000 })) {
          await btn.click();
          log.info(`OTP submitted via: ${sel}`);
          await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
          return true;
        }
      } catch { /* try next */ }
    }

    log.warn('OTP entered but could not find submit button');
    return true;
  } catch (err) {
    log.error(`OTP handling error: ${err.message}`);
    return false;
  }
}

/**
 * Login with retry mechanism
 */
async function loginWithRetry(page, email, password, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    log.info(`Login attempt ${attempt}/${maxRetries}...`);

    const success = await performLogin(page, email, password);
    if (success) return true;

    if (attempt < maxRetries) {
      const delay = 5000 * attempt;
      log.warn(`Login failed. Retrying in ${delay / 1000}s...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  log.fatal(`Login failed after ${maxRetries} attempts. Please verify credentials manually.`);
  return false;
}

module.exports = { performLogin, loginWithRetry };
