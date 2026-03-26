const { createComponentLogger } = require('../utils/logger');
const { loadJsonConfig, saveJsonConfig, loadSelectors } = require('../utils/config');
const { randomDelay } = require('./delays');
const { navigateToProfileModal, clearAndType, clickSaveAndWait } = require('../browser/pageHelpers');
const { sendNotification } = require('../utils/mailer');

const log = createComponentLogger('HeadlineUpdater');

function rotateHeadline() {
  const data = loadJsonConfig('headlines.json');
  const previousIndex = data.currentIndex;
  const nextIndex = (data.currentIndex + 1) % data.headlines.length;
  const headline = data.headlines[nextIndex];

  data.currentIndex = nextIndex;
  data.lastUpdated = new Date().toISOString();
  saveJsonConfig('headlines.json', data);

  log.info(`Headline rotated: index ${previousIndex} → ${nextIndex} (of ${data.headlines.length})`);
  return { headline, index: nextIndex };
}

async function updateHeadlineOnProfile(page, newHeadline) {
  const selectors = loadSelectors();
  const cfg = selectors.resumeHeadlineField;

  try {
    // Navigate to profile, hover section, click pencil, wait for form
    await navigateToProfileModal(page, cfg);

    const textarea = page.locator(cfg.textareaSelector).first();
    await textarea.waitFor({ state: 'visible', timeout: 8000 });

    log.info('Typing new headline...');
    await clearAndType(page, textarea, newHeadline);
    await randomDelay(800, 1500);

    await clickSaveAndWait(page, cfg.saveButtonSelector);

    log.success(`Headline updated: "${newHeadline.substring(0, 60)}..."`);
    await sendNotification(
      '✅ Naukri — Headline Updated',
      `Profile updated successfully.\n\nAction: Resume Headline\nNew value: ${newHeadline}`
    );
    return true;
  } catch (err) {
    log.error(`Failed to update headline: ${err.message}`);
    try {
      const fs = require('fs'), path = require('path');
      const dir = path.join(process.cwd(), 'debug');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, `headline_fail_${Date.now()}.png`), fullPage: true });
    } catch { /* ignore */ }
    return false;
  }
}

async function executeHeadlineUpdate(page) {
  log.info('=== Starting Headline Update ===');
  try {
    const { headline, index } = rotateHeadline();
    log.info(`Next headline [${index}]: "${headline.substring(0, 60)}..."`);
    const success = await updateHeadlineOnProfile(page, headline);
    log.info(success ? `Headline update complete [index: ${index}]` : 'Headline update failed');
    return success;
  } catch (err) {
    log.error(`Headline update error: ${err.message}`);
    return false;
  }
}

module.exports = { rotateHeadline, updateHeadlineOnProfile, executeHeadlineUpdate };
