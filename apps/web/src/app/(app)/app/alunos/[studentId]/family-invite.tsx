'use client';

import { useTranslations } from 'next-intl';
import { Send } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import {
  inviteFamilyAction,
  type FamilyInviteState,
} from '@/app/(app)/dashboard/students/[id]/family-access.actions';
import { ShareLink, type Invitee } from '@/app/(app)/dashboard/students/[id]/family-access';

const INITIAL: FamilyInviteState = { ok: false };

/**
 * *App da família* on the teacher's phone (Rui, 07-11-2026): one tap per person
 * not yet in the app. By email when the club has one, otherwise a link to share.
 * The API allows it only for a student in the teacher's own turmas.
 */
export function FamilyInvite({
  studentId,
  studentFirstName,
  organizationName,
  invitees,
}: {
  studentId: string;
  studentFirstName: string;
  organizationName: string;
  invitees: Invitee[];
}): React.ReactElement | null {
  const t = useTranslations();
  const open = invitees.filter((one) => one.state !== 'in_app');
  if (open.length === 0) return null;
  return (
    <section className="flex flex-col">
      <h2 className="app-section-label">{t('app.teaching.familyApp')}</h2>
      <ul className="flex flex-col divide-y divide-border">
        {open.map((invitee) => (
          <Row
            key={invitee.membershipId ?? 'self'}
            studentId={studentId}
            invitee={invitee}
            shareText={
              invitee.kind === 'self'
                ? t('familyAccess.shareTextSelf', { club: organizationName })
                : t('familyAccess.shareText', { club: organizationName, student: studentFirstName })
            }
          />
        ))}
      </ul>
    </section>
  );
}

function Row({
  studentId,
  invitee,
  shareText,
}: {
  studentId: string;
  invitee: Invitee;
  shareText: string;
}): React.ReactElement {
  const t = useTranslations();
  const [state, invite, pending] = useSavedAction(inviteFamilyAction, INITIAL);
  const sent = invitee.state === 'invited' && !state.ok;

  return (
    <li className="flex flex-col gap-2 py-2">
      <div className="flex min-h-[44px] items-center justify-between gap-3">
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{invitee.name}</span>
          {invitee.relationship !== null && (
            <span className="text-sm text-foreground-muted">{invitee.relationship}</span>
          )}
        </span>
        {sent ? (
          <span className="shrink-0 text-sm text-foreground-muted">{t('app.teaching.familyInvited')}</span>
        ) : (
          !state.ok && (
            <form action={invite}>
              <input type="hidden" name="studentId" value={studentId} />
              <input type="hidden" name="membershipId" value={invitee.membershipId ?? ''} />
              <input type="hidden" name="channel" value={invitee.email === null ? 'link' : 'email'} />
              <input type="hidden" name="rowKey" value={invitee.membershipId ?? 'self'} />
              <button
                type="submit"
                disabled={pending}
                className="inline-flex h-control shrink-0 items-center justify-center gap-2 rounded-sm bg-primary px-4 text-control font-medium text-primary-foreground disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <Send className="size-4" aria-hidden />
                {t('app.teaching.familyInvite')}
              </button>
            </form>
          )
        )}
      </div>
      {state.ok && state.link !== undefined && !state.emailed && <ShareLink link={state.link} text={shareText} />}
    </li>
  );
}
