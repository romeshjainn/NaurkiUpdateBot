const fs = require('fs');
const path = require('path');
const { createComponentLogger } = require('../utils/logger');
const { loadSelectors, loadAppConfig } = require('../utils/config');
const { randomDelay, addNetworkDelay } = require('./delays');
const { sendNotification } = require('../utils/mailer');
const { snap } = require('../utils/screenshot');

const RESUME_UPLOAD_NAME = 'RomeshJain_SoftwareEngineer_Resume.pdf';

const log = createComponentLogger('ResumeUploader');

/**
 * Upload (replace) the resume on Naukri profile page.
 * Clicks the "Update resume" button which triggers a file chooser,
 * then sets the file via the chooser event — no delete step needed.
 * @param {object} page - Playwright page
 * @param {string} resumePath - Absolute or relative path to resume file
 * @returns {boolean} Success
 */
async function uploadResume(page, resumePath) {
  const selectors = loadSelectors();
  const config = loadAppConfig();

  const resolvedPath = path.resolve(resumePath);
  if (!fs.existsSync(resolvedPath)) {
    log.error(`Resume file not found: ${resolvedPath}`);
    return false;
  }

  log.info(`Uploading resume: ${resolvedPath}`);

  try {
    // Navigate to profile page where the upload button lives
    await page.goto(config.urls.profile, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await randomDelay(2000, 3000);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await randomDelay(1000, 1500);
    await snap(page, 'resume_1_profile_page');

    // Wait for the "Update resume" button
    const trigger = page.locator(selectors.resumeUpload.triggerSelector).first();
    await trigger.waitFor({ state: 'visible', timeout: 10000 });

    log.info('Clicking "Update resume" button...');

    // Intercept the file chooser and upload with the correct display name
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 8000 }),
      trigger.click(),
    ]);

    await fileChooser.setFiles({
      name: RESUME_UPLOAD_NAME,
      mimeType: 'application/pdf',
      buffer: fs.readFileSync(resolvedPath),
    });
    log.info(`File selected as "${RESUME_UPLOAD_NAME}". Waiting for upload to complete...`);
    await snap(page, 'resume_2_file_selected');

    // Wait for upload processing
    await randomDelay(5000, 8000);
    await addNetworkDelay(page);

    // Check for success notification
    try {
      await page.waitForSelector(
        '[class*="toast"], [class*="success"], [class*="snackbar"], [role="alert"]',
        { timeout: 10000 }
      );
      log.success('Upload success notification detected');
    } catch {
      log.warn('No upload notification detected — upload may still have succeeded.');
    }

    await snap(page, 'resume_3_upload_done');
    await randomDelay(2000, 3000);
    log.success('Resume upload complete');
    await sendNotification(
      '✅ Naukri — Resume Uploaded',
      `Profile updated successfully.\n\nAction: Resume Upload\nFile: ${RESUME_UPLOAD_NAME}`
    );
    return true;
  } catch (err) {
    log.error(`Resume upload failed: ${err.message}`);
    try {
      const debugDir = path.join(process.cwd(), 'debug');
      if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
      await page.screenshot({ path: path.join(debugDir, `resume_fail_${Date.now()}.png`), fullPage: true });
    } catch { /* ignore */ }
    return false;
  }
}

/**
 * Execute the resume upload cycle.
 * @param {object} page - Playwright page
 * @param {string} resumePath - Path to resume PDF
 * @returns {boolean} Success
 */
async function executeResumeUploadCycle(page, resumePath) {
  log.info('=== Starting Resume Upload ===');

  try {
    await randomDelay(2000, 4000);

    let success = await uploadResume(page, resumePath);

    if (!success) {
      log.warn('Upload failed. Retrying in 5 seconds...');
      await randomDelay(5000, 7000);
      success = await uploadResume(page, resumePath);
    }

    log.info(`Resume upload: ${success ? 'SUCCESS' : 'FAILED'}`);
    return success;
  } catch (err) {
    log.error(`Resume upload cycle error: ${err.message}`);
    return false;
  }
}

module.exports = { uploadResume, executeResumeUploadCycle };
