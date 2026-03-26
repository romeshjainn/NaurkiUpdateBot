const { createComponentLogger } = require('../utils/logger');
const { loadSelectors, loadAppConfig } = require('../utils/config');
const { randomDelay, simulateTyping } = require('../automation/delays');

const log = createComponentLogger('Auth');

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

    let emailField = await findLoginEmailField(page, selectors);

    if (!emailField) {
      await page.screenshot({ path: 'debug/login_email_not_found.png', fullPage: true });
      throw new Error('Could not locate email input field after triggering login. See debug screenshot.');
    }

    log.debug('Email field located. Typing email...');
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
          log.debug(`Password field found: ${selector}`);
          break;
        }
      } catch {
        // try next
      }
    }

    if (!passwordField) {
      await page.screenshot({ path: 'debug/login_password_not_found.png', fullPage: true });
      throw new Error('Could not locate password input field. See debug screenshot.');
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
          log.debug(`Login button found: ${selector}`);
          break;
        }
      } catch {
        // try next
      }
    }

    if (!loginButton) {
      await page.screenshot({ path: 'debug/login_button_not_found.png', fullPage: true });
      throw new Error('Could not locate login button. See debug screenshot.');
    }

    await randomDelay(500, 1000);
    await loginButton.click();

    log.info('Login button clicked. Waiting for response...');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await randomDelay(3000, 5000);

    // Check success: should no longer be on the login page
    const currentUrl = page.url();
    if (currentUrl.includes('nlogin') || currentUrl.includes('/login')) {
      // Still on login — look for an error message
      try {
        const errorEl = page.locator('[class*="error" i], [class*="erMsg" i], .alert-danger').first();
        if (await errorEl.isVisible({ timeout: 2000 })) {
          const text = await errorEl.textContent();
          log.error(`Login error message: ${text.trim()}`);
          return false;
        }
      } catch {
        // no visible error
      }
      log.warn('Still on login page after submitting. Login may have failed.');
      await page.screenshot({ path: 'debug/login_still_on_page.png', fullPage: true });
      return false;
    }

    log.success('Login successful!');
    return true;
  } catch (err) {
    log.error(`Login error: ${err.message}`);
    try {
      await page.screenshot({ path: `debug/login_error_${Date.now()}.png`, fullPage: true });
    } catch {
      // screenshot failed
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
