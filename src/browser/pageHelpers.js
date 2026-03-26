const { createComponentLogger } = require('../utils/logger');
const { loadAppConfig } = require('../utils/config');
const { randomDelay } = require('../automation/delays');

const log = createComponentLogger('PageHelper');

/**
 * Scroll the page in increments to trigger lazy-loaded React sections.
 */
async function scrollPageFully(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      const distance = 400;
      const delay = 200;
      let scrolled = 0;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        scrolled += distance;
        if (scrolled >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, delay);
    });
  });
  await randomDelay(1500, 2500); // Let React render newly visible sections
  // Scroll back to top so hover/click coordinates are predictable
  await page.evaluate(() => window.scrollTo(0, 0));
  await randomDelay(500, 800);
}

/**
 * Navigate to the profile page, scroll the full page to trigger all lazy sections,
 * then find + hover + click the edit pencil for the given section.
 *
 * @param {object} page        - Playwright page
 * @param {object} fieldConfig - selectors.json entry (label, formSelector)
 */
async function navigateToProfileModal(page, fieldConfig) {
  const config = loadAppConfig();

  log.info(`Navigating to profile page for "${fieldConfig.label}"...`);
  await page.goto(config.urls.profile, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await randomDelay(2000, 3000);
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await randomDelay(1000, 1500);

  // Scroll full page so all lazy-rendered sections appear in the DOM
  log.info('Scrolling page to trigger lazy sections...');
  await scrollPageFully(page);

  // Find the widgetHead that contains this section's title
  const widgetHead = page
    .locator('.widgetHead')
    .filter({ hasText: fieldConfig.label })
    .first();

  // Scroll it into view
  await widgetHead.scrollIntoViewIfNeeded();
  await randomDelay(600, 1000);

  // Hover to reveal the edit icon
  await widgetHead.hover();
  await randomDelay(500, 800);

  // Click the edit (pencil) icon scoped to this widgetHead
  const editIcon = widgetHead.locator('span.edit.icon').first();
  await editIcon.waitFor({ state: 'visible', timeout: 8000 });
  await editIcon.click();
  log.info(`Clicked edit icon for "${fieldConfig.label}"`);
  await randomDelay(1000, 1800);

  // Wait for the inline edit form
  await page.waitForSelector(fieldConfig.formSelector, { state: 'visible', timeout: 10000 });
  await randomDelay(500, 1000);

  log.info(`Edit form ready for "${fieldConfig.label}"`);
}

/**
 * Clear a textarea and type new text with human-like delays.
 */
async function clearAndType(page, element, text) {
  await element.scrollIntoViewIfNeeded();
  await randomDelay(300, 600);
  await element.click();
  await randomDelay(300, 500);
  await page.keyboard.press('Control+A');
  await randomDelay(150, 300);
  await page.keyboard.press('Backspace');
  await randomDelay(300, 500);
  const { simulateTyping } = require('../automation/delays');
  await simulateTyping(page, element, text);
}

/**
 * Click save and wait for a success toast/notification.
 */
async function clickSaveAndWait(page, saveButtonSelector) {
  const saveBtn = page.locator(saveButtonSelector).first();
  await saveBtn.waitFor({ state: 'visible', timeout: 5000 });
  await randomDelay(500, 1000);
  await saveBtn.click();

  log.info('Save clicked. Waiting for confirmation...');
  try {
    await page.waitForSelector(
      '[class*="toast"], [class*="success"], [class*="snackbar"], [role="alert"]',
      { timeout: 8000 }
    );
    log.success('Save confirmed');
  } catch {
    log.warn('No toast detected — save may still have worked.');
  }
  await randomDelay(2000, 3000);
}

/**
 * Simulate mouse movement to an element before clicking.
 */
async function humanClick(page, element) {
  try {
    const box = await element.boundingBox();
    if (!box) { await element.click(); return; }
    const x = box.x + box.width / 2 + (Math.random() * 6 - 3);
    const y = box.y + box.height / 2 + (Math.random() * 6 - 3);
    await page.mouse.move(x, y, { steps: 3 + Math.floor(Math.random() * 3) });
    await randomDelay(100, 300);
    await page.mouse.click(x, y);
  } catch {
    await element.click();
  }
}

module.exports = {
  navigateToProfileModal,
  clearAndType,
  clickSaveAndWait,
  humanClick,
};
