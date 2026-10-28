import { sendEmail } from '../../../apps/api/src/notifications/notifier.js';

/**
 * "The backup or the drill failed" — POOLSE-89. Run by the workflows'
 * `if: failure()` step, so any failure — a dump, an upload, a restore, a proof,
 * a stale backup — reaches `PLATFORM_ALERT_EMAIL` and not only a red run nobody
 * is watching.
 *
 * In Portuguese only, as every platform alert is (`platform-alert-email.ts`):
 * it is addressed to Poolse's own operator, not to a club. The message carries
 * the job, and the run's address where the step's own output says what failed.
 * Through the API's one email path, so `EMAIL_PROVIDER` decides whether it
 * leaves; with it unset the alert is printed and the run is still red.
 *
 * Run: node --import tsx scripts/backup-alert.ts "<job>" "<run url>"
 */

const [job = 'cópia de segurança', runUrl = ''] = process.argv.slice(2);
const to = (process.env['PLATFORM_ALERT_EMAIL'] ?? '').trim();

const lines = [
  `Falhou: ${job}.`,
  `Quando: ${new Date().toISOString()} (UTC).`,
  runUrl === '' ? '' : `O registo da execução diz o que falhou: ${runUrl}`,
  'Até ser resolvido, a cópia de segurança mais recente pode não servir para repor o Poolse. O procedimento está em docs/deploy.md, «Backups and restoring».',
].filter(Boolean);

if (to === '') {
  console.error(`PLATFORM_ALERT_EMAIL is not set; the alert was not sent:\n${lines.join('\n')}`);
} else {
  const sent = await sendEmail({
    to,
    subject: `Poolse — falhou: ${job}`,
    text: lines.join('\n\n'),
    html: lines.map((line) => `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`).join('\n'),
  });
  console.log(sent ? `Alert sent to ${to}.` : 'The alert was not sent (see above).');
}
