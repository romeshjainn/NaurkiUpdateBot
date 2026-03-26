const fs = require('fs');
const path = require('path');
const { createComponentLogger } = require('./logger');

const log = createComponentLogger('Config');

const CONFIG_DIR = path.join(process.cwd(), 'config');

/**
 * Load a JSON config file safely
 */
function loadJsonConfig(filename) {
  const filepath = path.join(CONFIG_DIR, filename);
  if (!fs.existsSync(filepath)) {
    throw new Error(`Config file not found: ${filepath}`);
  }
  const raw = fs.readFileSync(filepath, 'utf8');
  return JSON.parse(raw);
}

/**
 * Save a JSON config file
 */
function saveJsonConfig(filename, data) {
  const filepath = path.join(CONFIG_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Load the main application config
 */
function loadAppConfig() {
  const config = loadJsonConfig('config.json');

  // Override with env variables if present
  return {
    resumePath: process.env.RESUME_PATH || config.resumePath || './resume.pdf',
    resumeFileName: config.resumeFileName || 'RomeshJain_SoftwareEngineer_2years',
    maxRetries: parseInt(process.env.MAX_RETRIES) || config.maxRetries || 3,
    retryDelayMs: parseInt(process.env.RETRY_DELAY_MS) || config.retryDelayMs || 2000,
    headless: process.env.HEADLESS === 'false' ? false : (config.headless !== false),
    slowMotion: parseInt(process.env.SLOW_MO) || config.slowMotion || 100,
    updateWindowStart: parseInt(process.env.UPDATE_WINDOW_START) || config.updateWindowStart || 9,
    updateWindowEnd: parseInt(process.env.UPDATE_WINDOW_END) || config.updateWindowEnd || 12,
    uploadWindowStart: parseInt(process.env.UPLOAD_WINDOW_START) || config.uploadWindowStart || 10,
    uploadWindowEnd: parseInt(process.env.UPLOAD_WINDOW_END) || config.uploadWindowEnd || 11,
    timezone: process.env.TIMEZONE || config.timezone || 'Asia/Kolkata',
    logLevel: process.env.LOG_LEVEL || config.logLevel || 'INFO',
    sessionMaxAgeDays: config.sessionMaxAgeDays || 30,
    minGapBetweenJobsMinutes: config.minGapBetweenJobsMinutes || 30,
    userAgent: process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    urls: {
      home: process.env.NAUKRI_HOME_URL || 'https://www.naukri.com/',
      login: process.env.NAUKRI_LOGIN_URL || 'https://www.naukri.com/nlogin/login',
      profile: process.env.NAUKRI_PROFILE_URL || 'https://www.naukri.com/mnjuser/profile',
      get profileModal() { return this.profile + '?action=modalOpen'; },
    },
  };
}

/**
 * Load selectors configuration
 */
function loadSelectors() {
  return loadJsonConfig('selectors.json');
}

/**
 * Check if all required config files exist
 */
function validateConfigFiles() {
  const required = ['headlines.json', 'summaries.json', 'config.json', 'selectors.json'];
  const missing = [];

  for (const file of required) {
    const filepath = path.join(CONFIG_DIR, file);
    if (!fs.existsSync(filepath)) {
      missing.push(file);
    }
  }

  if (missing.length > 0) {
    log.error(`Missing config files: ${missing.join(', ')}`);
    return false;
  }

  log.info('All config files validated');
  return true;
}

/**
 * Check if credentials file exists
 */
function credentialsExist() {
  return fs.existsSync(path.join(CONFIG_DIR, 'credentials.enc'));
}

/**
 * Check if session file exists
 */
function sessionExists() {
  return fs.existsSync(path.join(CONFIG_DIR, 'session.json'));
}

module.exports = {
  loadJsonConfig,
  saveJsonConfig,
  loadAppConfig,
  loadSelectors,
  validateConfigFiles,
  credentialsExist,
  sessionExists,
  CONFIG_DIR,
};
