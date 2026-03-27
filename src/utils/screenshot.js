const fs = require('fs');
const path = require('path');

const DEBUG_DIR = path.join(process.cwd(), 'debug');
if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });

/**
 * Take a labelled screenshot and save it to the debug folder.
 * Filename format: step_<label>_<timestamp>.png
 * Silently ignores errors so it never breaks the main flow.
 */
async function snap(page, label) {
  try {
    const filename = `step_${label}_${Date.now()}.png`;
    const dest = path.join(DEBUG_DIR, filename);
    await page.screenshot({ path: dest, fullPage: true });
  } catch { /* never crash the caller */ }
}

module.exports = { snap };
