'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { UserPlus } from 'lucide-react';
import { Reveal } from '@/components/ui/reveal';
import { TextField, useSuccessKey } from '@/components/ui/field';
import { FromLink } from '@/components/from-link';
import { useSavedAction } from '@/lib/saved';
import { ShareLink } from './[id]/family-access';
import { inviteNewStudentAction, type InviteStudentState } from './family-bulk.actions';

const INITIAL: InviteStudentState = { ok: false };
const BUTTON = 'inline-flex h-control items-center justify-center gap-2 rounded px-4 text-control disabled:opacity-60';

/**
 * *Convidar aluno* — somebody not yet on the register (Rui, 30-10-2026).
 *
 * A name and a phone and/or an email. Convidar creates the student and invites
 * them: an address gets the email, and the link comes back either way, to send
 * from the club's phone (WhatsApp, SMS) through the share menu. The level, the
 * turma and the rest are filled in on the record afterwards — the panel links
 * to it.
 */
export function InviteStudent({ organizationName }: { organizationName: string }): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useSavedAction(inviteNewStudentAction, INITIAL);
  // A new form after each invitation that worked, so the next one starts empty.
  const fresh = useSuccessKey(state);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => panel.current?.querySelector<HTMLInputElement>('input')?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [open]);

  const field = (name: string): string | undefined => {
    const key = state.fields?.[name];
    return key === undefined ? undefined : t(key, state.values);
  };

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="invite-student"
        onClick={() => setOpen((was) => !was)}
        className={`${BUTTON} self-start bg-primary text-primary-foreground hover:bg-primary/90`}
      >
        <UserPlus className="size-4" aria-hidden />
        {t('inviteStudent.open')}
      </button>

      <Reveal open={open} id="invite-student">
        <div
          ref={panel}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
          }}
          className="flex flex-col gap-4 rounded border border-border bg-surface p-5"
        >
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold">{t('inviteStudent.title')}</h2>
            <p className="text-sm text-foreground-muted">{t('inviteStudent.intro')}</p>
          </div>

          <form key={fresh} action={action} className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TextField name="firstName" label={t('inviteStudent.firstName')} required error={field('firstName')} />
              <TextField name="lastName" label={t('inviteStudent.lastName')} required error={field('lastName')} />
              <TextField
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                label={t('inviteStudent.phone')}
                error={field('phone')}
              />
              <TextField
                name="email"
                type="email"
                autoComplete="off"
                label={t('inviteStudent.email')}
                error={field('email')}
              />
            </div>
            <p className="text-sm text-foreground-muted">{t('inviteStudent.hint')}</p>
            {state.errorKey === 'inviteStudent.exists' && (
              <p className="text-sm text-warning">
                {t('inviteStudent.existsLong', { name: String(state.values?.['name'] ?? '') })}{' '}
                {state.existingStudentId != null && (
                  <FromLink
                    href={`/dashboard/students/${state.existingStudentId}`}
                    className="text-primary underline underline-offset-2"
                  >
                    {t('inviteStudent.openExisting')}
                  </FromLink>
                )}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={pending} className={`${BUTTON} bg-primary text-primary-foreground hover:bg-primary/90`}>
                {pending ? t('common.working') : t('inviteStudent.submit')}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className={`${BUTTON} border border-border bg-surface hover:bg-surface-muted`}
              >
                {t('common.cancel')}
              </button>
            </div>
          </form>

          {state.ok && state.link !== undefined && (
            <>
              <ShareLink link={state.link} text={t('familyAccess.shareTextSelf', { club: organizationName })} />
              {state.studentId !== undefined && (
                <FromLink
                  href={`/dashboard/students/${state.studentId}`}
                  className="self-start text-sm text-primary underline-offset-2 hover:underline coarse:-my-3 coarse:py-3"
                >
                  {t('inviteStudent.openRecord')}
                </FromLink>
              )}
            </>
          )}
        </div>
      </Reveal>
    </div>
  );
}
