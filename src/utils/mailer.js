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

/**
 * Send the post-run summary email with HTML layout and optional PDF attachment.
 *
 * @param {object} opts
 * @param {string}      opts.runTime         - Human-readable run timestamp
 * @param {string}      opts.resumeUploadedAt - Time resume was uploaded
 * @param {boolean}     opts.resumeOk
 * @param {string|null} opts.pdfPath          - Path to generated PDF (attached if present)
 * @param {string}      opts.previousHeadline
 * @param {string}      opts.newHeadline
 * @param {boolean}     opts.headlineDone     - Whether headline was actually updated
 * @param {string}      opts.previousSummary
 * @param {string}      opts.newSummary
 * @param {boolean}     opts.summaryDone      - Whether summary was actually updated
 * @param {string}      opts.todayAction      - 'headline' | 'summary' | 'both'
 * @param {string[]}    opts.skipped          - Labels of skipped steps
 */
async function sendRunSummary(opts) {
  const transport = getTransporter();
  if (!transport) {
    log.warn('SMTP not configured — skipping run summary email.');
    return;
  }

  const to = process.env.SMTP_TO || process.env.SMTP_USER;

  const esc = (s) => (s || '—').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const tick = (b) => b ? '✅' : '❌';
  const skippedLine = opts.skipped.length
    ? `<p style="color:#888">⏭ <b>Skipped today:</b> ${opts.skipped.join(', ')}</p>`
    : '';

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:700px;margin:auto;padding:24px">
  <h2 style="color:#1a73e8;border-bottom:2px solid #1a73e8;padding-bottom:8px">
    Naukri Bot — Daily Run Summary
  </h2>
  <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
    <tr><td style="padding:6px 0;color:#555;width:180px">Run started</td>
        <td><b>${esc(opts.runTime)}</b></td></tr>
    <tr><td style="padding:6px 0;color:#555">Today's action</td>
        <td><b>${esc(opts.todayAction.toUpperCase())}</b></td></tr>
    <tr><td style="padding:6px 0;color:#555">Resume uploaded</td>
        <td>${tick(opts.resumeOk)} ${opts.resumeOk ? esc(opts.resumeUploadedAt) : 'FAILED'}</td></tr>
  </table>

  <h3 style="color:#333;border-bottom:1px solid #ddd;padding-bottom:6px">
    ${tick(opts.headlineDone)} Resume Headline
  </h3>
  <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
    <tr>
      <td style="padding:8px;background:#fff3f3;border-radius:4px;width:50%;vertical-align:top">
        <div style="font-size:11px;color:#888;margin-bottom:4px">PREVIOUS</div>
        ${esc(opts.previousHeadline)}
      </td>
      <td style="padding:4px;text-align:center;font-size:20px;vertical-align:middle">→</td>
      <td style="padding:8px;background:#f3fff3;border-radius:4px;width:50%;vertical-align:top">
        <div style="font-size:11px;color:#888;margin-bottom:4px">NEW</div>
        ${opts.headlineDone ? `<b>${esc(opts.newHeadline)}</b>` : '<span style="color:#888">not updated today</span>'}
      </td>
    </tr>
  </table>

  <h3 style="color:#333;border-bottom:1px solid #ddd;padding-bottom:6px">
    ${tick(opts.summaryDone)} Profile Summary
  </h3>
  <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
    <tr>
      <td style="padding:8px;background:#fff3f3;border-radius:4px;width:50%;vertical-align:top">
        <div style="font-size:11px;color:#888;margin-bottom:4px">PREVIOUS</div>
        <span style="white-space:pre-wrap">${esc(opts.previousSummary)}</span>
      </td>
      <td style="padding:4px;text-align:center;font-size:20px;vertical-align:middle">→</td>
      <td style="padding:8px;background:#f3fff3;border-radius:4px;width:50%;vertical-align:top">
        <div style="font-size:11px;color:#888;margin-bottom:4px">NEW</div>
        ${opts.summaryDone
          ? `<b><span style="white-space:pre-wrap">${esc(opts.newSummary)}</span></b>`
          : '<span style="color:#888">not updated today</span>'}
      </td>
    </tr>
  </table>

  ${skippedLine}
  <p style="color:#aaa;font-size:12px;margin-top:32px">Naukri Automation Bot</p>
</body>
</html>`;

  const mailOpts = {
    from: `"Naukri Bot" <${process.env.SMTP_USER}>`,
    to,
    subject: `Naukri Bot — ${opts.todayAction.toUpperCase()} updated · ${opts.runTime}`,
    html,
    attachments: [],
  };

  if (opts.pdfPath) {
    const fs = require('fs');
    if (fs.existsSync(opts.pdfPath)) {
      mailOpts.attachments.push({
        filename: 'resume_generated.pdf',
        path: opts.pdfPath,
        contentType: 'application/pdf',
      });
    }
  }

  try {
    await transport.sendMail(mailOpts);
    log.success(`Run summary email sent → ${to}`);
  } catch (err) {
    log.error(`Failed to send run summary email: ${err.message}`);
  }
}

module.exports = { sendNotification, sendRunSummary };
