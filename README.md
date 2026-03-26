# Naukri Profile Automation Bot

Automate daily Naukri.com profile optimization to maximize recruiter visibility while maintaining human-like behavior patterns.

## What It Does

- **Daily Headline Rotation** — Cycles through 6 keyword-rich headlines to keep your profile fresh
- **Daily Summary Rotation** — Rotates 12 professional summaries highlighting different strengths
- **Daily Resume Re-Upload** — Deletes and re-uploads your resume to trigger Naukri's "recently updated" algorithm boost
- **Human-Like Behavior** — Random delays, character-by-character typing, mouse movements — designed to avoid bot detection
- **Persistent Sessions** — Logs in once, encrypts and reuses session cookies
- **Automatic Scheduling** — Runs autonomously with randomized daily timing windows

## Expected Impact

Based on Naukri optimization research, daily profile updates can result in:
- 3-5x increase in recruiter profile views within 30 days
- 2-3x increase in recruiter messages
- Top ranking in recruiter search results for target keywords

## Prerequisites

- Node.js v16 or higher
- A Naukri.com account
- Your resume as a clean, single-column PDF

## Quick Start

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd naukri-automation-bot
npm install
npx playwright install chromium
```

### 2. Add Your Resume

Place your resume PDF in the project root:

```bash
cp /path/to/your/resume.pdf ./resume.pdf
```

### 3. Run Setup

```bash
npm run setup
```

This will:
- Generate an encryption key
- Collect and encrypt your Naukri credentials
- Optionally test login with a browser
- Validate all config files

### 4. Start the Bot

```bash
npm start
```

The bot will schedule daily jobs automatically:
- **Headline + Summary update**: Random time between 9:00-12:00 IST
- **Resume re-upload**: Random time between 10:00-11:00 IST

### 5. Monitor Logs

```bash
tail -f logs/naukri_bot.log
```

## Usage Modes

### Continuous Mode (Default)
```bash
npm start
```
Runs 24/7, scheduling daily jobs automatically.

### Run Once Mode
```bash
npm run run:once
```
Executes all jobs immediately and exits. Useful for testing.

### Test Selectors
```bash
npm run test:selectors
```
Launches a headed browser to verify all CSS/XPath selectors work on the current Naukri UI.

## Configuration

### Customize Headlines (`config/headlines.json`)
Edit the headlines array with your own keyword-rich professional headlines. The bot rotates through them sequentially.

### Customize Summaries (`config/summaries.json`)
Edit the summaries array with 3-4 line professional summaries. Each should include your core keywords and highlight different expertise areas.

### Timing Windows (`.env`)
```env
UPDATE_WINDOW_START=9    # Headline/summary: start hour (IST)
UPDATE_WINDOW_END=12     # Headline/summary: end hour (IST)
UPLOAD_WINDOW_START=10   # Resume upload: start hour (IST)
UPLOAD_WINDOW_END=11     # Resume upload: end hour (IST)
```

### Browser Mode (`.env`)
```env
HEADLESS=true     # Set to "false" to see the browser
SLOW_MO=100       # Milliseconds of delay between Playwright actions
```

## Project Structure

```
naukri-automation-bot/
├── src/
│   ├── index.js                  Main entry point & scheduler
│   ├── setup.js                  Interactive first-run setup
│   ├── auth/
│   │   ├── login.js              Login flow with fallback selectors
│   │   ├── sessionManager.js     Cookie persistence & session refresh
│   │   └── encryption.js         AES-256 credential encryption
│   ├── automation/
│   │   ├── headlineUpdater.js    Headline rotation & profile update
│   │   ├── summaryUpdater.js     Summary rotation & profile update
│   │   ├── resumeUploader.js     Resume delete/upload cycle
│   │   └── delays.js             Human-like delay utilities
│   ├── utils/
│   │   ├── logger.js             Winston logging (file + console)
│   │   ├── config.js             Config file loader
│   │   └── validators.js         Page state & file validators
│   └── browser/
│       ├── browserManager.js     Playwright browser initialization
│       └── pageHelpers.js        Fallback selector engine & helpers
├── config/
│   ├── headlines.json            6 headline variations
│   ├── summaries.json            12 summary variations
│   ├── config.json               App settings
│   ├── selectors.json            CSS/XPath selectors with fallbacks
│   ├── credentials.enc           Encrypted credentials (generated)
│   └── session.json              Encrypted session cookies (generated)
├── test/
│   └── testSelectors.js          Selector validation test suite
├── logs/                         Log files (auto-created)
├── debug/                        Debug screenshots (auto-created)
├── resume.pdf                    Your resume
├── .env                          Environment variables
└── package.json
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| **"Credentials not found"** | Run `npm run setup` |
| **Session keeps expiring** | Delete `config/session.json` and restart |
| **Selectors not finding fields** | Run `npm run test:selectors`, check debug screenshots, update `config/selectors.json` |
| **Resume upload fails** | Ensure `resume.pdf` exists, is < 5MB, and is a clean single-column PDF |
| **CAPTCHA triggered** | Wait 1 hour. If persistent, log in manually once, then restart the bot |
| **Login fails** | Delete `config/credentials.enc`, run `npm run setup` to re-enter credentials |
| **Bot detected** | Increase `SLOW_MO` in `.env`, ensure `HEADLESS=true` |

## Security Notes

- Credentials are encrypted with AES-256-CBC
- Encryption key is stored in `.env` (keep this file safe!)
- Session cookies are encrypted at rest
- Plain-text credentials are never logged
- `.gitignore` excludes all sensitive files

## Resume Tips for Naukri

For best results with Naukri's ATS parser:
- Use a simple, single-column layout
- Standard section headers: "Technical Skills", "Professional Experience", "Projects", "Education"
- No images, tables, or fancy graphics
- Include keywords exactly as they appear in target job descriptions

## License

Private — For personal use only.
