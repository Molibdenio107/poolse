'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { BookUser, Mail, MessageCircle, MessageSquare, Share2 } from 'lucide-react';

/** What the server drew: the club's pre-registration page, its QR, and the words to send with it. */
export interface ClubInvite {
  url: string;
  png: string;
  message: string;
}

const BUTTON =
  'inline-flex h-control shrink-0 items-center justify-center gap-2 rounded-sm px-4 text-control font-medium disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const FIELD =
  'h-control min-w-0 flex-1 rounded-sm border border-border bg-surface px-3 text-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary';

/** The phone's contact picker (Chrome on Android); absent elsewhere, and then the field is typed. */
type ContactPicker = { select: (props: string[], options?: { multiple?: boolean }) => Promise<Record<string, string[]>[]> };
const picker = (): ContactPicker | null =>
  typeof navigator !== 'undefined' && 'contacts' in navigator ? (navigator as unknown as { contacts: ContactPicker }).contacts : null;

/**
 * Inviting somebody to the club (Rui, 07-11-2026): the pre-registration page as a
 * square QR, a share button, WhatsApp and SMS (to a number, or the app's own
 * contact chooser when none is given), and an email to send it to. Sending
 * opens the phone's own mail or SMS app with the words ready, so Poolse sends
 * nothing and the club's name is never used to write to strangers. A request that
 * comes of it lands in the secretaria's queue like any other.
 */
export function InviteToClub({ invite }: { invite: ClubInvite }): React.ReactElement {
  const t = useTranslations();
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const text = `${invite.message} ${invite.url}`;
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const contacts = picker();

  const pick = async (kind: 'email' | 'tel'): Promise<void> => {
    try {
      const [chosen] = (await contacts?.select([kind], { multiple: false })) ?? [];
      const value = chosen?.[kind]?.[0];
      if (value !== undefined) (kind === 'email' ? setEmail : setPhone)(value);
    } catch {
      // Closing the picker is an answer, not a failure.
    }
  };

  const mailto = `mailto:${encodeURIComponent(email.trim())}?subject=${encodeURIComponent(invite.message)}&body=${encodeURIComponent(text)}`;
  const digits = phone.replace(/[^\d]/g, '');
  // Without a number, WhatsApp and the SMS app open on their own contact chooser.
  // A Portuguese mobile typed as nine digits gets its country code for WhatsApp.
  const international = /^9\d{8}$/.test(digits) ? `351${digits}` : digits;
  const sms = `sms:${phone.replace(/[^\d+]/g, '')}?body=${encodeURIComponent(text)}`;
  const whatsapp = `https://wa.me/${international}?text=${encodeURIComponent(text)}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-2 text-center">
        {/* Square on every screen: the radius tokens turn into pills on a phone. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- a data URL drawn on the server */}
        <img src={invite.png} alt={t('invite.qrAlt')} className="size-56 bg-white" style={{ borderRadius: 4 }} />
        <p className="text-sm text-foreground-muted">{t('invite.qrHint')}</p>
      </div>

      {canShare && (
        <button
          type="button"
          onClick={() => void navigator.share({ text }).catch(() => undefined)}
          className={`${BUTTON} self-center bg-primary text-primary-foreground`}
        >
          <Share2 className="size-4" aria-hidden />
          {t('invite.share')}
        </button>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{t('invite.byEmail')}</span>
        <span className="flex gap-2">
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className={FIELD} autoComplete="email" />
          {contacts !== null && (
            <button type="button" onClick={() => void pick('email')} aria-label={t('invite.fromContacts')} className={`${BUTTON} bg-surface px-3 shadow-card`}>
              <BookUser className="size-4" aria-hidden />
            </button>
          )}
          <a
            href={mailto}
            aria-disabled={email.trim() === ''}
            className={`${BUTTON} bg-surface shadow-card ${email.trim() === '' ? 'pointer-events-none opacity-60' : ''}`}
          >
            <Mail className="size-4" aria-hidden />
            {t('invite.send')}
          </a>
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{t('invite.byPhone')}</span>
        <span className="flex gap-2">
          <input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} className={FIELD} autoComplete="tel" />
          {contacts !== null && (
            <button type="button" onClick={() => void pick('tel')} aria-label={t('invite.fromContacts')} className={`${BUTTON} bg-surface px-3 shadow-card`}>
              <BookUser className="size-4" aria-hidden />
            </button>
          )}
        </span>
      </label>
      <div className="flex gap-2">
        <a href={whatsapp} target="_blank" rel="noreferrer" className={`${BUTTON} flex-1 bg-surface shadow-card`}>
          <MessageCircle className="size-4" aria-hidden />
          WhatsApp
        </a>
        <a href={sms} className={`${BUTTON} flex-1 bg-surface shadow-card`}>
          <MessageSquare className="size-4" aria-hidden />
          SMS
        </a>
      </div>
    </div>
  );
}
