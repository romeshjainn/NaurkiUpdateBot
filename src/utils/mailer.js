const nodemailer = require('nodemailer');
const { createComponentLogger } = require('./logger');

const log = createComponentLogger('Mailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT) || 587,
    secure: false,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  return transporter;
}

/**
 * Send a notification email. Silently skips if SMTP is not configured.
 * @param {string} subject
 * @param {string} body - Plain text body
 */
async function sendNotification(subject, body) {
  const transport = getTransporter();
  if (!transport) {
    log.warn('SMTP not configured — skipping email notification.');
    return;
  }

  const to = process.env.SMTP_TO || process.env.SMTP_USER;

  try {
    await transport.sendMail({
      from: `"Naukri Bot" <${process.env.SMTP_USER}>`,
      to,
      subject,
      text: body,
      html: `<pre style="font-family:sans-serif;font-size:14px">${body}</pre>`,
    });
    log.success(`Email sent → ${to} | "${subject}"`);
  } catch (err) {
    log.error(`Failed to send email: ${err.message}`);
  }
}

module.exports = { sendNotification };
