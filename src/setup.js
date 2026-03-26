#!/usr/bin/env node

/**
 * Naukri Automation Bot - First-Time Setup
 * 
 * This script handles:
 * 1. Generating encryption key
 * 2. Collecting and encrypting Naukri credentials
 * 3. Performing initial login to save session cookies
 * 4. Validating all config files
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Load .env if it exists
const dotenvPath = path.join(process.cwd(), '.env');
if (fs.existsSync(dotenvPath)) {
  require('dotenv').config();
}

const { createComponentLogger } = require('./utils/logger');
const { validateConfigFiles, CONFIG_DIR } = require('./utils/config');
const { generateEncryptionKey, encryptCredentials } = require('./auth/encryption');
const { initBrowser, closeBrowser } = require('./browser/browserManager');
const { performLogin } = require('./auth/login');
const { saveSessionCookies } = require('./auth/sessionManager');

const log = createComponentLogger('Setup');

/**
 * Create readline interface for user input
 */
function createPrompt() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/**
 * Ask a question and return the answer
 */
function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

/**
 * Ask for password (Note: Node.js readline doesn't natively hide input,
 * but we can use a workaround)
 */
function askPassword(rl, question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    
    if (stdin.setRawMode) {
      stdin.setRawMode(true);
    }
    stdin.resume();

    let password = '';
    const onData = (ch) => {
      const c = ch.toString('utf8');

      switch (c) {
        case '\n':
        case '\r':
        case '\u0004': // Ctrl+D
          if (stdin.setRawMode) stdin.setRawMode(wasRaw);
          stdin.removeListener('data', onData);
          stdin.pause();
          process.stdout.write('\n');
          resolve(password);
          break;
        case '\u0003': // Ctrl+C
          process.exit(1);
          break;
        case '\u007F': // Backspace
        case '\b':
          if (password.length > 0) {
            password = password.slice(0, -1);
            process.stdout.clearLine(0);
            process.stdout.cursorTo(0);
            process.stdout.write(question + '*'.repeat(password.length));
          }
          break;
        default:
          password += c;
          process.stdout.write('*');
          break;
      }
    };

    stdin.on('data', onData);
  });
}

/**
 * Main setup flow
 */
async function runSetup() {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║     Naukri Automation Bot - First Setup      ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  const rl = createPrompt();

  try {
    // Step 1: Validate config files
    console.log('📋 Step 1: Checking config files...');
    if (!validateConfigFiles()) {
      console.log('❌ Missing config files. Please ensure all config files are present.');
      process.exit(1);
    }
    console.log('✅ Config files OK\n');

    // Step 2: Generate or verify encryption key
    console.log('🔑 Step 2: Setting up encryption...');
    let envContent = '';
    const envExamplePath = path.join(process.cwd(), '.env.example');

    if (fs.existsSync(dotenvPath)) {
      envContent = fs.readFileSync(dotenvPath, 'utf8');
    } else if (fs.existsSync(envExamplePath)) {
      envContent = fs.readFileSync(envExamplePath, 'utf8');
    }

    if (!process.env.ENCRYPTION_KEY) {
      const newKey = generateEncryptionKey();
      
      if (envContent.includes('ENCRYPTION_KEY=')) {
        // Replace existing empty key
        envContent = envContent.replace(
          /ENCRYPTION_KEY=.*/,
          `ENCRYPTION_KEY=${newKey}`
        );
      } else {
        envContent += `\nENCRYPTION_KEY=${newKey}\n`;
      }

      fs.writeFileSync(dotenvPath, envContent, 'utf8');
      process.env.ENCRYPTION_KEY = newKey;
      console.log('✅ Encryption key generated and saved to .env');
    } else {
      console.log('✅ Encryption key already exists');
    }
    console.log('');

    // Step 3: Collect Naukri credentials
    console.log('🔐 Step 3: Naukri Login Credentials');
    console.log('   (These will be encrypted and stored locally)\n');

    const email = await ask(rl, '   Enter your Naukri email: ');
    if (!email || !email.includes('@')) {
      console.log('❌ Invalid email address');
      process.exit(1);
    }

    let password;
    try {
      password = await askPassword(rl, '   Enter your Naukri password: ');
    } catch {
      // Fallback for environments that don't support raw mode
      password = await ask(rl, '   Enter your Naukri password: ');
    }

    if (!password) {
      console.log('❌ Password cannot be empty');
      process.exit(1);
    }

    // Encrypt and save credentials
    // Reload dotenv to pick up the new key
    require('dotenv').config({ override: true });
    encryptCredentials(email, password);
    console.log('✅ Credentials encrypted and saved\n');

    // Step 4: Test login with browser
    console.log('🌐 Step 4: Testing login with browser...');
    const proceed = await ask(rl, '   Launch browser to test login? (y/n): ');

    if (proceed.toLowerCase() === 'y') {
      rl.close();

      const { browser, context, page } = await initBrowser();

      try {
        const loginSuccess = await performLogin(page, email, password);

        if (loginSuccess) {
          console.log('✅ Login successful!');

          // Save session cookies
          await saveSessionCookies(context);
          console.log('✅ Session cookies saved');
        } else {
          console.log('⚠️  Login test failed. You may need to verify credentials.');
          console.log('   The bot will attempt login again when it runs.');
        }
      } finally {
        await closeBrowser();
      }
    } else {
      rl.close();
      console.log('   Skipping browser login test.');
      console.log('   Login will happen automatically on first run.');
    }

    // Step 5: Verify resume file
    console.log('\n📄 Step 5: Resume file check...');
    const resumePath = path.resolve('./resume.pdf');
    if (fs.existsSync(resumePath)) {
      const size = (fs.statSync(resumePath).size / 1024).toFixed(1);
      console.log(`✅ Resume found: ${resumePath} (${size}KB)`);
    } else {
      console.log('⚠️  resume.pdf not found in project root.');
      console.log('   Place your resume as ./resume.pdf before running the bot.');
    }

    // Step 6: Create necessary directories
    const dirs = ['logs', 'debug'];
    for (const dir of dirs) {
      const dirPath = path.join(process.cwd(), dir);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
    }

    // Done!
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║          ✅ Setup Complete!                   ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log('\nNext steps:');
    console.log('  1. Place your resume as ./resume.pdf (if not done)');
    console.log('  2. Review config files in ./config/');
    console.log('  3. Run: npm start');
    console.log('  4. Monitor: tail -f logs/naukri_bot.log\n');

  } catch (err) {
    console.error(`\n❌ Setup failed: ${err.message}`);
    log.error(`Setup error: ${err.message}`);
    process.exit(1);
  } finally {
    try { rl.close(); } catch {}
  }

  process.exit(0);
}

runSetup();
