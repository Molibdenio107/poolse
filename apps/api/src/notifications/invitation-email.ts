import type { Email } from './notifier.js';

export interface InvitationEmailInput {
  to: string;
  organizationName: string;
  /** Already-translated role names, in the organization's language. */
  roles: string[];
  link: string;
  expiresAt: Date;
  locale: string;
}

/**
 * The invitation email, in the organization's language.
 *
 * The *organization's* language, not the recipient's — we do not know theirs.
 * They have no account yet, which is the entire point of the message. A club
 * that runs in Portuguese inviting its own instructor is overwhelmingly likely
 * to be inviting a Portuguese speaker, and the alternative is defaulting
 * everyone to English.
 *
 * Text and HTML both, because a text/plain alternative is what stops a
 * transactional message from being scored as bulk mail — and because the link
 * has to be usable in a client that renders no HTML at all.
 */
const ROLE_NAMES: Record<string, Record<string, string>> = {
  'pt-PT': {
    owner: 'Proprietário',
    admin: 'Administrador',
    instructor: 'Instrutor',
    maintenance: 'Manutenção',
    student: 'Aluno',
    guardian: 'Encarregado de educação',
  },
  en: {
    owner: 'Owner',
    admin: 'Administrator',
    instructor: 'Instructor',
    maintenance: 'Maintenance',
    student: 'Student',
    guardian: 'Guardian',
  },
};

/**
 * Duplicated from the web message catalogues rather than imported.
 *
 * The API does not depend on the web app and should not start doing so for six
 * words. `pnpm i18n:check` cannot see this file, so the trade is explicit: if a
 * role is ever added, this map and the two catalogues all need it, and the
 * `member_role` enum in the database is the list to check against.
 */
function roleName(role: string, locale: string): string {
  return ROLE_NAMES[locale]?.[role] ?? ROLE_NAMES['en']?.[role] ?? role;
}

export function invitationEmail(input: InvitationEmailInput): Email {
  const pt = input.locale === 'pt-PT';
  const roles = input.roles.map((role) => roleName(role, input.locale)).join(', ');
  const expires = new Intl.DateTimeFormat(pt ? 'pt-PT' : 'en-GB', {
    dateStyle: 'long',
    timeZone: 'Europe/Lisbon',
  }).format(input.expiresAt);

  const subject = pt
    ? `Convite para ${input.organizationName} no Poolse`
    : `You have been invited to ${input.organizationName} on Poolse`;

  const lines = pt
    ? [
        `Foi convidado para ${input.organizationName}.`,
        '',
        `Funções: ${roles}`,
        '',
        'Aceite o convite aqui:',
        input.link,
        '',
        `A ligação expira a ${expires} e só pode ser usada uma vez.`,
        '',
        'Se não estava à espera deste convite, ignore este email.',
      ]
    : [
        `You have been invited to ${input.organizationName}.`,
        '',
        `Roles: ${roles}`,
        '',
        'Accept the invitation here:',
        input.link,
        '',
        `The link expires on ${expires} and can only be used once.`,
        '',
        'If you were not expecting this invitation, you can ignore this email.',
      ];

  const button = pt ? 'Aceitar convite' : 'Accept invitation';
  const fallback = pt
    ? 'Se o botão não funcionar, copie esta ligação:'
    : 'If the button does not work, copy this link:';

  // Inline styles and a table-free layout: every email client strips <style>
  // blocks, and a message that has to look right in Outlook is not the place to
  // reuse the app's design tokens.
  const html = `<!doctype html>
<html lang="${pt ? 'pt-PT' : 'en'}">
  <body style="margin:0;padding:24px;background:#f4f6f7;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#11181c;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #d9e0e5;border-radius:8px;padding:32px;">
      <p style="margin:0 0 16px;font-size:18px;font-weight:600;">${escapeHtml(
        pt
          ? `Foi convidado para ${input.organizationName}.`
          : `You have been invited to ${input.organizationName}.`,
      )}</p>
      <p style="margin:0 0 24px;color:#5a6770;">${escapeHtml(pt ? 'Funções' : 'Roles')}: ${escapeHtml(roles)}</p>
      <p style="margin:0 0 24px;">
        <a href="${escapeHtml(input.link)}" style="display:inline-block;background:#67a6b6;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:500;">${button}</a>
      </p>
      <p style="margin:0 0 8px;color:#5a6770;font-size:13px;">${fallback}</p>
      <p style="margin:0 0 24px;word-break:break-all;font-size:13px;"><a href="${escapeHtml(input.link)}" style="color:#3d7d8c;">${escapeHtml(input.link)}</a></p>
      <p style="margin:0;color:#5a6770;font-size:13px;">${escapeHtml(
        pt
          ? `A ligação expira a ${expires} e só pode ser usada uma vez. Se não estava à espera deste convite, ignore este email.`
          : `The link expires on ${expires} and can only be used once. If you were not expecting this invitation, you can ignore this email.`,
      )}</p>
    </div>
  </body>
</html>`;

  return { to: input.to, subject, text: lines.join('\n'), html };
}

/** The organization name is operator-supplied text going into markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
