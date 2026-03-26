const { createComponentLogger } = require('../utils/logger');

const log = createComponentLogger('Delays');

/**
 * Generate a random integer between min and max (inclusive)
 */
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

/**
 * Sleep for a random duration between min and max milliseconds
 */
async function randomDelay(min, max) {
  const delay = randomInt(min, max);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Get a random execution time within a time window (in IST)
 * @param {number} windowStart - Start hour (24h format, e.g., 9)
 * @param {number} windowEnd - End hour (24h format, e.g., 12)
 * @returns {{ delayMs: number, executionTime: Date } | null}
 */
function getRandomTimeWindow(windowStart, windowEnd) {
  // Get current time in IST
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000; // IST = UTC + 5:30
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  const istNow = new Date(utcMs + istOffset);

  const currentHour = istNow.getHours();
  const currentMinute = istNow.getMinutes();
  const currentTotalMinutes = currentHour * 60 + currentMinute;

  const windowStartMinutes = windowStart * 60;
  const windowEndMinutes = windowEnd * 60;

  // If current time is past the window, return null (wait for next day)
  if (currentTotalMinutes >= windowEndMinutes) {
    return null;
  }

  // Calculate random target time within window
  const effectiveStart = Math.max(windowStartMinutes, currentTotalMinutes + 1);
  if (effectiveStart >= windowEndMinutes) {
    return null;
  }

  const targetMinutes = effectiveStart + Math.random() * (windowEndMinutes - effectiveStart);
  const targetHour = Math.floor(targetMinutes / 60);
  const targetMinute = Math.floor(targetMinutes % 60);

  // Create IST target date
  const targetIST = new Date(istNow);
  targetIST.setHours(targetHour, targetMinute, randomInt(0, 59), 0);

  // Calculate delay from now
  const delayMs = targetIST.getTime() - istNow.getTime();

  if (delayMs <= 0) return null;

  return { delayMs, executionTime: targetIST };
}

/**
 * Calculate delay until next day's execution window
 * @param {number} windowStart - Start hour of execution window
 * @returns {number} Milliseconds until next window
 */
function getDelayUntilNextWindow(windowStart) {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  const istNow = new Date(utcMs + istOffset);

  // Next day at windowStart
  const tomorrow = new Date(istNow);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(windowStart, randomInt(0, 59), randomInt(0, 59), 0);

  return tomorrow.getTime() - istNow.getTime();
}

/**
 * Simulate human typing character by character
 * @param {object} page - Playwright page
 * @param {object} element - Target element locator
 * @param {string} text - Text to type
 */
async function simulateTyping(page, element, text) {
  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // Random per-character delay: 50-150ms
    const charDelay = randomInt(50, 150);
    await element.type(char, { delay: charDelay });

    // Every ~10 characters, 5% chance of a longer thinking pause
    if (i > 0 && i % 10 === 0 && Math.random() < 0.05) {
      await randomDelay(400, 600);
    }

    // Every ~15 characters, 3% chance to simulate a typo (backspace + retype)
    if (i > 0 && i % 15 === 0 && Math.random() < 0.03) {
      await randomDelay(100, 200);
      await page.keyboard.press('Backspace');
      await randomDelay(150, 300);
      await element.type(char, { delay: randomInt(80, 150) });
    }
  }
}

/**
 * Add a random delay that simulates reading/browsing
 * 50% chance: 3-7s (reading), 50% chance: 1-3s (quick glance)
 */
async function randomSequenceDelay() {
  if (Math.random() < 0.5) {
    await randomDelay(3000, 7000);
  } else {
    await randomDelay(1000, 3000);
  }
}

/**
 * Wait for network to settle after an action
 */
async function addNetworkDelay(page) {
  try {
    await page.waitForLoadState('networkidle', { timeout: 15000 });
  } catch {
    log.warn('Network idle timeout (15s) - continuing anyway');
  }
  // Extra buffer after network settles
  await randomDelay(2000, 3000);
}

module.exports = {
  randomInt,
  randomDelay,
  getRandomTimeWindow,
  getDelayUntilNextWindow,
  simulateTyping,
  randomSequenceDelay,
  addNetworkDelay,
};
