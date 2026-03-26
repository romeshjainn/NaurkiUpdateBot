const { createComponentLogger } = require('../utils/logger');
const { loadJsonConfig, saveJsonConfig, loadSelectors } = require('../utils/config');
const { randomDelay } = require('./delays');
const { navigateToProfileModal, clearAndType, clickSaveAndWait } = require('../browser/pageHelpers');
const { sendNotification } = require('../utils/mailer');

const log = createComponentLogger('SummaryUpdater');

function rotateSummary() {
  const data = loadJsonConfig('summaries.json');
  const previousIndex = data.currentIndex;
  const nextIndex = (data.currentIndex + 1) % data.summaries.length;
  const summary = data.summaries[nextIndex];

  data.currentIndex = nextIndex;
  data.lastUpdated = new Date().toISOString();
  saveJsonConfig('summaries.json', data);

  log.info(`Summary rotated: index ${previousIndex} → ${nextIndex} (of ${data.summaries.length})`);
  return { summary, index: nextIndex };
}

async function updateSummaryOnProfile(page, newSummary) {
  const selectors = loadSelectors();
  const cfg = selectors.profileSummaryField;

  try {
    // Navigate to profile, hover section, click pencil, wait for form
    await navigateToProfileModal(page, cfg);

    const textarea = page.locator(cfg.textareaSelector).first();
    await textarea.waitFor({ state: 'visible', timeout: 8000 });

    log.info('Typing new summary...');
    await clearAndType(page, textarea, newSummary);
    await randomDelay(800, 1500);

    await clickSaveAndWait(page, cfg.saveButtonSelector);

    log.success(`Summary updated (${newSummary.length} chars)`);
    await sendNotification(
      '✅ Naukri — Summary Updated',
      `Profile updated successfully.\n\nAction: Profile Summary\nNew value:\n${newSummary}`
    );
    return true;
  } catch (err) {
    log.error(`Failed to update summary: ${err.message}`);
    try {
      const fs = require('fs'), path = require('path');
      const dir = path.join(process.cwd(), 'debug');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, `summary_fail_${Date.now()}.png`), fullPage: true });
    } catch { /* ignore */ }
    return false;
  }
}

async function executeSummaryUpdate(page) {
  log.info('=== Starting Summary Update ===');
  try {
    const { summary, index } = rotateSummary();
    log.info(`Next summary [${index}]: "${summary.substring(0, 80)}..."`);
    const success = await updateSummaryOnProfile(page, summary);
    log.info(success ? `Summary update complete [index: ${index}]` : 'Summary update failed');
    return success;
  } catch (err) {
    log.error(`Summary update error: ${err.message}`);
    return false;
  }
}

module.exports = { rotateSummary, updateSummaryOnProfile, executeSummaryUpdate };
