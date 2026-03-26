const fs = require('fs');
const path = require('path');
const { createComponentLogger } = require('./logger');

const log = createComponentLogger('Validator');

/**
 * Validate that the resume file exists and is readable
 */
function validateResumeFile(resumePath) {
  const resolved = path.resolve(resumePath);
  if (!fs.existsSync(resolved)) {
    log.error(`Resume file not found: ${resolved}`);
    return false;
  }

  const stats = fs.statSync(resolved);
  if (stats.size === 0) {
    log.error(`Resume file is empty: ${resolved}`);
    return false;
  }

  // Check file extension
  const ext = path.extname(resolved).toLowerCase();
  if (!['.pdf', '.doc', '.docx'].includes(ext)) {
    log.warn(`Resume file has unexpected extension: ${ext}. Expected .pdf, .doc, or .docx`);
  }

  // Check file size (max 5MB for Naukri)
  const sizeMB = stats.size / (1024 * 1024);
  if (sizeMB > 5) {
    log.warn(`Resume file is ${sizeMB.toFixed(2)}MB. Naukri may reject files over 5MB`);
  }

  log.info(`Resume file validated: ${resolved} (${sizeMB.toFixed(2)}MB)`);
  return true;
}

/**
 * Validate that the page is showing a logged-in state
 */
async function validateLoggedIn(page) {
  try {
    // Check multiple indicators of logged-in state
    const indicators = [
      'a[title="View & Update your profile"]',
      '[class*="nI-gNb-drawer"]',
      '[class*="user-name"]',
      'a[href*="mnjuser/profile"]',
    ];

    for (const selector of indicators) {
      try {
        const element = await page.locator(selector).first();
        if (await element.isVisible({ timeout: 2000 })) {
          log.debug(`Logged-in indicator found: ${selector}`);
          return true;
        }
      } catch {
        // Try next indicator
      }
    }

    // Fallback: check URL doesn't redirect to login
    const url = page.url();
    if (url.includes('nlogin') || url.includes('login')) {
      log.warn('Page redirected to login - session is invalid');
      return false;
    }

    // If on profile page and no error, likely logged in
    if (url.includes('mnjuser/profile')) {
      log.info('On profile page - assuming logged in');
      return true;
    }

    log.warn('Could not confirm logged-in state');
    return false;
  } catch (err) {
    log.error(`Error validating login state: ${err.message}`);
    return false;
  }
}

/**
 * Validate environment variables
 */
function validateEnvVars() {
  const required = ['ENCRYPTION_KEY'];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    log.warn(`Missing env variables: ${missing.join(', ')}. Run 'npm run setup' first.`);
    return false;
  }
  return true;
}

module.exports = {
  validateResumeFile,
  validateLoggedIn,
  validateEnvVars,
};
