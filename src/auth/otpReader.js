const { ImapFlow } = require('imapflow');
const { createComponentLogger } = require('../utils/logger');

const log = createComponentLogger('OTPReader');

/**
 * Extract the Naukri OTP from raw email source text.
 * Tries targeted patterns first (most specific → least specific) to avoid
 * matching 6-digit numbers in email headers, message IDs, or timestamps.
 */
function extractOTP(text) {
  const strategies = [
    // 1. Digit on its own line (how Naukri formats it: "\n125295\n")
    /^\s*(\d{6})\s*$/m,
    // 2. Explicitly after "OTP" keyword with possible punctuation/space
    /(?:OTP|otp|one.time.password)[^\d]{0,30}(\d{6})/i,
    // 3. After "enter" / "below" / "code" keywords
    /(?:enter|below|code)[^\d]{0,30}(\d{6})/i,
    // 4. 6-digit number that appears before "Note:" or "Valid" (Naukri body structure)
    /(\d{6})\s*\r?\n\s*(?:Note|Valid|Regards)/i,
  ];

  for (const regex of strategies) {
    const match = text.match(regex);
    if (match) {
      log.info(`OTP extracted via pattern: ${regex}`);
      return match[1];
    }
  }
  return null;
}

/**
 * Waits for a Naukri OTP email and returns the 6-digit code.
 * Polls inbox every 5 seconds for up to 2 minutes.
 */
async function fetchNaukriOTP(emailAddress, appPassword) {
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: emailAddress, pass: appPassword },
    logger: false,
  });

  // Look back 10 min to catch emails from recent retry attempts too
  const since = new Date(Date.now() - 10 * 60 * 1000);
  const deadline = Date.now() + 2 * 60 * 1000; // wait up to 2 min

  await client.connect();

  // Gmail splits emails across tabs (Primary, Updates, Promotions etc.).
  // In IMAP each tab is a separate folder — searching only INBOX misses them.
  // '[Gmail]/All Mail' covers every label/tab so nothing is skipped.
  const FOLDERS = ['[Gmail]/All Mail', 'INBOX'];

  try {
    while (Date.now() < deadline) {
      for (const folder of FOLDERS) {
        try {
          await client.mailboxOpen(folder);
        } catch {
          log.info(`Folder "${folder}" not accessible, skipping`);
          continue;
        }

        // Search all (seen + unseen) from info@naukri.com — sort by date ourselves
        const uids = await client.search({ since, from: 'info@naukri.com' });
        log.info(`[${folder}] Found ${uids.length} email(s) from info@naukri.com`);

        if (uids.length === 0) continue;

        // Fetch envelope (date) + source, sort newest-first
        const candidates = [];
        for (const uid of uids) {
          try {
            const msg = await client.fetchOne(uid, { envelope: true, source: true });
            const sentAt = msg.envelope?.date ? new Date(msg.envelope.date).getTime() : 0;
            candidates.push({ uid, sentAt, text: msg.source.toString() });
          } catch { /* skip malformed */ }
        }
        candidates.sort((a, b) => b.sentAt - a.sentAt);

        for (const { uid, sentAt, text } of candidates) {
          const otp = extractOTP(text);
          if (otp) {
            const age = Math.round((Date.now() - sentAt) / 1000);
            log.info(`OTP found in "${folder}" (sent ${age}s ago, uid ${uid}): ${otp}`);
            await client.messageFlagsAdd(uid, ['\\Seen']);
            return otp;
          }
        }
      }

      log.info('OTP email not found yet, retrying in 5s...');
      await new Promise((r) => setTimeout(r, 5000));
    }

    log.error('Timed out waiting for OTP email');
    return null;
  } finally {
    await client.logout();
  }
}

module.exports = { fetchNaukriOTP };
