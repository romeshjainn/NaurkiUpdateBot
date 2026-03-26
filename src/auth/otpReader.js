const { ImapFlow } = require('imapflow');
const { createComponentLogger } = require('../utils/logger');

const log = createComponentLogger('OTPReader');

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

  const since = new Date(Date.now() - 5 * 60 * 1000); // look back 5 min max
  const deadline = Date.now() + 2 * 60 * 1000;        // wait up to 2 min

  await client.connect();

  try {
    while (Date.now() < deadline) {
      await client.mailboxOpen('INBOX');

      const msgs = await client.search({
        since,
        from: 'naukri',
        unseen: true,
      });

      for (const uid of msgs.reverse()) {
        const msg = await client.fetchOne(uid, { bodyStructure: true, source: true });
        const text = msg.source.toString();

        const match = text.match(/\b(\d{6})\b/);
        if (match) {
          log.info('OTP found in email');
          await client.messageFlagsAdd(uid, ['\\Seen']);
          return match[1];
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
