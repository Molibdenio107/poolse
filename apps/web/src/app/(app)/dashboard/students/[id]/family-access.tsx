'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { timeAgo } from '@/lib/relative-time';
import { CheckCircle2, Clock, Mail, Share2, Smartphone, UserX } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import { Reveal } from '@/components/ui/reveal';
import { TextField } from '@/components/ui/field';
import { formatDate } from '@/lib/date-format';
import {
  inviteFamilyAction,
  reissueFamilyAction,
  revokeFamilyAction,
  type FamilyInviteState,
} from './family-access.actions';

/**
 * *Acesso à app* — POOLSE-129 (Rui, 30-10-2026).
 *
 * One row per person on the record who may hold a login: each guardian, and the
 * student themself from 12. Each says where it stands in words, and offers the
 * two ways in: an email from Poolse, or a link the club sends from its own phone
 * (WhatsApp, SMS) through the phone's share menu. The link exists once — only
 * its hash is stored — so sharing a pending invitation again makes a new one.
 */

export interface Invitee {
  kind: 'guardian' | 'self';
  membershipId: string | null;
  name: string;
  relationship: string | null;
  email: string | null;
  phone: string | null;
  state: 'none' | 'invited' | 'expired' | 'in_app';
  /** POOLSE-130: when their login last opened Poolse, and when they joined. */
  lastSeenAt?: string | null;
  joinedAt?: string | null;
  invitation: {
    id: string;
    email: string | null;
    createdAt: string;
    expiresAt: string;
    delivery: string;
  } | null;
}

const INITIAL: FamilyInviteState = { ok: false };

const BUTTON =
  'inline-flex h-control items-center justify-center gap-2 rounded px-4 text-control disabled:opacity-60';
const PRIMARY = `${BUTTON} bg-primary text-primary-foreground hover:bg-primary/90`;
const SECONDARY = `${BUTTON} border border-border bg-surface hover:bg-surface-muted`;

export function FamilyAccess({
  studentId,
  studentFirstName,
  organizationName,
  canInvite,
  invitees,
}: {
  studentId: string;
  studentFirstName: string;
  organizationName: string;
  canInvite: boolean;
  invitees: Invitee[];
}): React.ReactElement {
  const t = useTranslations();

  return (
    <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">{t('familyAccess.title')}</h2>
        <p className="text-sm text-foreground-muted">{t('familyAccess.intro')}</p>
        {!canInvite && <p className="text-sm text-foreground-muted">{t('familyAccess.readOnly')}</p>}
      </div>

      {invitees.length === 0 ? (
        <p className="text-sm text-foreground-muted">{t('familyAccess.nobody')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {invitees.map((invitee) => (
            <InviteeRow
              key={invitee.kind === 'self' ? 'self' : invitee.membershipId}
              studentId={studentId}
              studentFirstName={studentFirstName}
              organizationName={organizationName}
              canInvite={canInvite}
              invitee={invitee}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function InviteeRow({
  studentId,
  studentFirstName,
  organizationName,
  canInvite,
  invitee,
}: {
  studentId: string;
  studentFirstName: string;
  organizationName: string;
  canInvite: boolean;
  invitee: Invitee;
}): React.ReactElement {
  const t = useTranslations();
  const rowKey = invitee.kind === 'self' ? 'self' : (invitee.membershipId ?? '');
  const [invite, inviteAction, inviting] = useSavedAction(inviteFamilyAction, INITIAL);
  const [renew, renewAction, renewing] = useSavedAction(reissueFamilyAction, INITIAL);
  const [, revokeAction, revoking] = useSavedAction(revokeFamilyAction, INITIAL);
  // Only for the busy label: the channel itself travels as the submit
  // button's own value, which is in the form data before any re-render.
  const [channel, setChannel] = useState<'email' | 'link'>('email');

  // The newest link this row produced, from either action.
  const issued = [renew, invite].find((state) => state.ok && state.link !== undefined && state.rowKey === rowKey);
  const busy = inviting || renewing || revoking;

  const who = invitee.kind === 'self' ? t('familyAccess.self') : invitee.relationship;
  const shareText =
    invitee.kind === 'self'
      ? t('familyAccess.shareTextSelf', { club: organizationName })
      : t('familyAccess.shareText', { club: organizationName, student: studentFirstName });

  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="font-medium">
            {invitee.name}
            {who !== null && who !== '' && <span className="font-normal text-foreground-muted"> · {who}</span>}
          </p>
          <p className="text-sm text-foreground-muted">
            {[invitee.email, invitee.phone].filter((v) => v !== null && v !== '').join(' · ') ||
              t('familyAccess.noContact')}
          </p>
        </div>
        <StateLine invitee={invitee} />
      </div>

      {canInvite && invitee.state !== 'in_app' && (
        <>
          {invitee.state === 'invited' && invitee.invitation !== null ? (
            <div className="flex flex-wrap gap-2">
              <form action={renewAction}>
                <input type="hidden" name="studentId" value={studentId} />
                <input type="hidden" name="invitationId" value={invitee.invitation.id} />
                <input type="hidden" name="rowKey" value={rowKey} />
                <button type="submit" disabled={busy} className={SECONDARY}>
                  <Share2 className="size-4" aria-hidden />
                  {busy && renewing ? t('common.working') : t('familyAccess.newLink')}
                </button>
              </form>
              <form action={revokeAction}>
                <input type="hidden" name="studentId" value={studentId} />
                <input type="hidden" name="invitationId" value={invitee.invitation.id} />
                <button type="submit" disabled={busy} className={SECONDARY}>
                  {t('familyAccess.revoke')}
                </button>
              </form>
            </div>
          ) : (
            <form action={inviteAction} className="flex flex-col gap-3">
              <input type="hidden" name="studentId" value={studentId} />
              <input type="hidden" name="membershipId" value={invitee.membershipId ?? ''} />
              <input type="hidden" name="rowKey" value={rowKey} />
              {invitee.email === null && (
                <TextField
                  name="email"
                  type="email"
                  autoComplete="off"
                  label={t('familyAccess.emailLabel')}
                  hint={t('familyAccess.emailHint')}
                  error={invite.fields?.['email'] === undefined ? undefined : t(invite.fields['email'])}
                  className="max-w-md"
                />
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  name="channel"
                  value="email"
                  onClick={() => setChannel('email')}
                  disabled={busy}
                  className={PRIMARY}
                >
                  <Mail className="size-4" aria-hidden />
                  {busy && inviting && channel === 'email' ? t('common.working') : t('familyAccess.sendEmail')}
                </button>
                <button
                  type="submit"
                  name="channel"
                  value="link"
                  onClick={() => setChannel('link')}
                  disabled={busy}
                  className={SECONDARY}
                >
                  <Share2 className="size-4" aria-hidden />
                  {busy && inviting && channel === 'link' ? t('common.working') : t('familyAccess.makeLink')}
                </button>
              </div>
            </form>
          )}

          {issued?.link !== undefined && <ShareLink link={issued.link} text={shareText} />}
        </>
      )}
    </li>
  );
}

function StateLine({ invitee }: { invitee: Invitee }): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const base = 'inline-flex items-center gap-1.5 text-sm';
  switch (invitee.state) {
    case 'in_app':
      return (
        <span className={`${base} text-success`}>
          <CheckCircle2 className="size-4" aria-hidden />
          {/* POOLSE-130: when they last opened it, in words. */}
          {invitee.lastSeenAt != null
            ? t('familyAccess.state.inAppSeen', { ago: timeAgo(invitee.lastSeenAt, locale) ?? '' })
            : invitee.joinedAt != null
              ? t('familyAccess.state.inAppJoined', { date: formatDate(invitee.joinedAt) })
              : t('familyAccess.state.inApp')}
        </span>
      );
    case 'invited':
      return (
        <span className={`${base} text-primary`}>
          {invitee.invitation?.email === null ? <Smartphone className="size-4" aria-hidden /> : <Mail className="size-4" aria-hidden />}
          {t(invitee.invitation?.email === null ? 'familyAccess.state.linked' : 'familyAccess.state.invited', {
            date: formatDate(invitee.invitation?.createdAt ?? null),
          })}
        </span>
      );
    case 'expired':
      return (
        <span className={`${base} text-warning`}>
          <Clock className="size-4" aria-hidden />
          {t('familyAccess.state.expired', { date: formatDate(invitee.invitation?.expiresAt ?? null) })}
        </span>
      );
    default:
      return (
        <span className={`${base} text-foreground-muted`}>
          <UserX className="size-4" aria-hidden />
          {t('familyAccess.state.none')}
        </span>
      );
  }
}

/**
 * The link, once, with the club's message around it. On a phone the share menu
 * opens with both (WhatsApp, SMS, …); elsewhere the text is copied. A second
 * tap rather than sharing straight after the server answers: a browser only
 * opens the share menu from a tap, and the wait for the server spends it.
 */
export function ShareLink({ link, text }: { link: string; text: string }): React.ReactElement {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);
  const message = `${text} ${link}`;
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function share(): Promise<void> {
    if (canShare) {
      try {
        await navigator.share({ text: message });
        return;
      } catch (error) {
        // Closing the menu is an answer, not a failure.
        if ((error as { name?: string }).name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-primary/40 bg-primary/10 p-4">
      <p className="text-sm">{t('familyAccess.linkOnce')}</p>
      <p className="break-words rounded bg-surface px-3 py-2 text-sm">{message}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void share()} className={PRIMARY}>
          <Share2 className="size-4" aria-hidden />
          {canShare ? t('familyAccess.share') : copied ? t('common.copied') : t('familyAccess.copy')}
        </button>
      </div>
    </div>
  );
}

/**
 * *Convidar para a app* on the record's first tab — Rui, 30-10-2026: one
 * student at a time, for somebody already registered who never joined. It
 * opens the same rows as *Acesso à app*, in place; it is not offered once
 * everybody on the record uses the app.
 */
export function AppInviteButton(props: {
  studentId: string;
  studentFirstName: string;
  organizationName: string;
  canInvite: boolean;
  invitees: Invitee[];
}): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="app-invite"
        onClick={() => setOpen((was) => !was)}
        className={`${SECONDARY} self-start`}
      >
        <Smartphone className="size-4" aria-hidden />
        {t('familyAccess.openButton')}
      </button>
      <Reveal open={open} id="app-invite">
        <FamilyAccess {...props} />
      </Reveal>
    </div>
  );
}
