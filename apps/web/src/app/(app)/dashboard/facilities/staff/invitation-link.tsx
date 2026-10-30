'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CreatedInvitation } from '../../../../../lib/api';

/**
 * The one place an invitation link is ever visible.
 *
 * Extracted from the invite form because it now has a second caller: reissuing.
 * Both need identical treatment, and the treatment is the point — the token
 * exists nowhere else, so this block is the only chance anyone gets to keep it.
 * It says so, rather than leaving the person to discover it by closing the tab.
 */
export function InvitationLink({
  invitation,
  tone = 'success',
}: {
  invitation: CreatedInvitation;
  tone?: 'success' | 'neutral';
}): React.ReactElement | null {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);

  // Built in the browser so the link always matches the origin the person is
  // actually on — localhost, the LAN address, staging — with no environment
  // variable to get wrong. Client components render on the server first, where
  // there is no window, hence the guard.
  if (typeof window === 'undefined') return null;
  const link = `${window.location.origin}/join?token=${encodeURIComponent(invitation.token)}`;

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function copy(): Promise<void> {
    // On a phone, the share menu (WhatsApp, SMS) — 30-10-2026.
    if (canShare) {
      try {
        await navigator.share({ text: `${t('invite.shareText')} ${link}` });
        return;
      } catch (error) {
        if ((error as { name?: string }).name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Clipboard blocked, or an insecure origin. The link is on screen and
      // selectable, so this is a lost convenience rather than a dead end.
      setCopied(false);
    }
  }

  const frame =
    tone === 'success'
      ? 'border-success/40 bg-success/10'
      : 'border-primary/40 bg-primary/10';

  return (
    <div className={`flex flex-col gap-2 rounded border p-4 ${frame}`}>
      <p className="font-medium">
        {invitation.email === null
          ? t('invite.createdLink')
          : invitation.emailed
            ? t('invite.emailed', { email: invitation.email })
            : t('invite.created', { email: invitation.email })}
      </p>
      <p className="text-sm text-foreground-muted">
        {invitation.emailed ? t('invite.emailedHint') : t('invite.linkHint')}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded bg-surface-muted px-3 py-2 font-mono text-xs">
          {link}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded border border-border bg-surface hover:bg-surface-muted"
        >
          {canShare ? t('familyAccess.share') : copied ? t('common.copied') : t('common.copy')}
        </button>
      </div>
    </div>
  );
}
