const { createComponentLogger } = require('../utils/logger');
const { validateLoggedIn } = require('../utils/validators');
const { loadAppConfig } = require('../utils/config');
const { loginWithRetry } = require('./login');
const {
  saveEncryptedSession,
  loadEncryptedSession,
  deleteSession,
  decryptCredentials,
  isSessionExpired,
} = require('./encryption');
const { randomDelay } = require('../automation/delays');

const log = createComponentLogger('SessionManager');

/**
 * Save current browser session cookies (encrypted)
 */
async function saveSessionCookies(context) {
  try {
    const cookies = await context.cookies();
    if (cookies.length === 0) {
      log.warn('No cookies to save');
      return false;
    }

    saveEncryptedSession(cookies);
    log.info(`Saved ${cookies.length} session cookies`);
    return true;
  } catch (err) {
    log.error(`Failed to save session: ${err.message}`);
    return false;
  }
}

/**
 * Load saved session cookies into browser context
 */
async function loadSessionCookies(context) {
  try {
    const config = loadAppConfig();
    const session = loadEncryptedSession();

    if (!session) {
      log.info('No saved session found');
      return false;
    }

    // Check if session is too old
    if (isSessionExpired(session, config.sessionMaxAgeDays)) {
      log.warn('Session expired. Deleting and requiring fresh login.');
      deleteSession();
      return false;
    }

    // Inject cookies into browser context
    const cookies = session.cookies;
    if (!cookies || cookies.length === 0) {
      log.warn('Session file has no cookies');
      deleteSession();
      return false;
    }

    await context.addCookies(cookies);
    log.info(`Injected ${cookies.length} session cookies`);
    return true;
  } catch (err) {
    log.error(`Failed to load session: ${err.message}`);
    deleteSession();
    return false;
  }
}

/**
 * Validate that the current session is still active
 */
async function validateSessionActive(page) {
  const config = loadAppConfig();

  try {
    log.info('Validating session...');
    await page.goto(config.urls.profile, { waitUntil: 'networkidle', timeout: 20000 });
    await randomDelay(2000, 3000);

    const isLoggedIn = await validateLoggedIn(page);
    if (isLoggedIn) {
      log.success('Session is valid - user is logged in');
      return true;
    }

    log.warn('Session appears invalid');
    return false;
  } catch (err) {
    log.error(`Session validation error: ${err.message}`);
    return false;
  }
}

/**
 * Full session refresh: decrypt credentials and perform fresh login
 */
async function refreshSession(page, context) {
  const config = loadAppConfig();

  try {
    log.info('Refreshing session with saved credentials...');

    // Delete old session
    deleteSession();

    // Decrypt stored credentials
    const { email, password } = decryptCredentials();

    // Perform login
    const success = await loginWithRetry(page, email, password, config.maxRetries);
    if (!success) {
      log.fatal('Session refresh failed. Manual intervention required.');
      return false;
    }

    // Save new session cookies
    await saveSessionCookies(context);
    log.success('Session refreshed successfully');
    return true;
  } catch (err) {
    log.error(`Session refresh error: ${err.message}`);
    return false;
  }
}

/**
 * Ensure we have a valid session. Try saved cookies first, then fresh login.
 * Returns true if session is ready for use.
 */
async function ensureSession(page, context) {
  // Step 1: Try loading saved cookies
  const cookiesLoaded = await loadSessionCookies(context);

  if (cookiesLoaded) {
    // Step 2: Validate the session
    const isValid = await validateSessionActive(page);
    if (isValid) {
      return true;
    }
    log.warn('Saved session is invalid. Performing fresh login...');
  }

  // Step 3: Fresh login required
  return await refreshSession(page, context);
}

module.exports = {
  saveSessionCookies,
  loadSessionCookies,
  validateSessionActive,
  refreshSession,
  ensureSession,
};
