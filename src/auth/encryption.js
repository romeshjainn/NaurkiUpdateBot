const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createComponentLogger } = require('../utils/logger');
const { CONFIG_DIR } = require('../utils/config');

const log = createComponentLogger('Encryption');

const ALGORITHM = 'aes-256-cbc';
const CREDENTIALS_FILE = path.join(CONFIG_DIR, 'credentials.enc');
const SESSION_FILE = path.join(CONFIG_DIR, 'session.json');

/**
 * Generate a new 32-byte encryption key (base64 encoded)
 * Called once during setup, stored in .env
 */
function generateEncryptionKey() {
  const key = crypto.randomBytes(32).toString('base64');
  log.info('Generated new encryption key');
  return key;
}

/**
 * Get the encryption key from env, ensuring it's 32 bytes
 */
function getEncryptionKey() {
  const keyBase64 = process.env.ENCRYPTION_KEY;
  if (!keyBase64) {
    throw new Error('ENCRYPTION_KEY not set in .env. Run "npm run setup" first.');
  }
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }
  return key;
}

/**
 * Encrypt a string (JSON data)
 */
function encrypt(plaintext) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  return {
    iv: iv.toString('hex'),
    encrypted,
  };
}

/**
 * Decrypt an encrypted string
 */
function decrypt(encryptedData) {
  const key = getEncryptionKey();
  const iv = Buffer.from(encryptedData.iv, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Encrypt and save credentials to file
 */
function encryptCredentials(email, password) {
  const data = JSON.stringify({ email, password });
  const encryptedData = encrypt(data);

  // Ensure config directory exists
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(encryptedData), 'utf8');

  // Set restrictive file permissions (owner read-write only)
  try {
    fs.chmodSync(CREDENTIALS_FILE, 0o600);
  } catch {
    log.warn('Could not set file permissions on credentials file (may be Windows)');
  }

  log.info('Credentials encrypted and saved');
  return true;
}

/**
 * Load and decrypt credentials from file
 */
function decryptCredentials() {
  if (!fs.existsSync(CREDENTIALS_FILE)) {
    throw new Error('Credentials file not found. Run "npm run setup" first.');
  }

  const raw = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
  const encryptedData = JSON.parse(raw);
  const decrypted = decrypt(encryptedData);
  const credentials = JSON.parse(decrypted);

  log.info('Credentials loaded and decrypted');
  return credentials;
}

/**
 * Encrypt and save session cookies to file
 */
function saveEncryptedSession(cookies) {
  const data = JSON.stringify({
    cookies,
    savedAt: new Date().toISOString(),
  });

  const encryptedData = encrypt(data);
  fs.writeFileSync(SESSION_FILE, JSON.stringify(encryptedData), 'utf8');

  try {
    fs.chmodSync(SESSION_FILE, 0o600);
  } catch {
    // Windows doesn't support chmod
  }

  log.info('Session cookies encrypted and saved');
  return true;
}

/**
 * Load and decrypt session cookies from file
 */
function loadEncryptedSession() {
  if (!fs.existsSync(SESSION_FILE)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(SESSION_FILE, 'utf8');
    const encryptedData = JSON.parse(raw);
    const decrypted = decrypt(encryptedData);
    const session = JSON.parse(decrypted);

    log.info(`Session loaded (saved at: ${session.savedAt})`);
    return session;
  } catch (err) {
    log.warn(`Failed to decrypt session: ${err.message}. Deleting corrupted session file.`);
    deleteSession();
    return null;
  }
}

/**
 * Delete session file
 */
function deleteSession() {
  if (fs.existsSync(SESSION_FILE)) {
    fs.unlinkSync(SESSION_FILE);
    log.info('Session file deleted');
  }
}

/**
 * Delete credentials file
 */
function deleteCredentials() {
  if (fs.existsSync(CREDENTIALS_FILE)) {
    fs.unlinkSync(CREDENTIALS_FILE);
    log.info('Credentials file deleted');
  }
}

/**
 * Check if session is expired (older than maxAgeDays)
 */
function isSessionExpired(session, maxAgeDays = 30) {
  if (!session || !session.savedAt) return true;

  const savedDate = new Date(session.savedAt);
  const now = new Date();
  const diffDays = (now - savedDate) / (1000 * 60 * 60 * 24);

  if (diffDays > maxAgeDays) {
    log.warn(`Session is ${Math.floor(diffDays)} days old (max: ${maxAgeDays}). Considered expired.`);
    return true;
  }

  return false;
}

module.exports = {
  generateEncryptionKey,
  encryptCredentials,
  decryptCredentials,
  saveEncryptedSession,
  loadEncryptedSession,
  deleteSession,
  deleteCredentials,
  isSessionExpired,
};
