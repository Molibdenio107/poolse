'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, UserPlus } from 'lucide-react';
import { Reveal } from '@/components/ui/reveal';
import { TextField, useSuccessKey } from '@/components/ui/field';
import { FromLink } from '@/components/from-link';
import { useSavedAction } from '@/lib/saved';
import { cn } from '@/lib/utils';
import { ShareLink } from './[id]/family-access';
import { inviteNewStudentAction, type InviteStudentState } from './family-bulk.actions';

const INITIAL: InviteStudentState = { ok: false };
const BUTTON = 'inline-flex h-control items-center justify-center gap-2 rounded-sm px-4 text-control disabled:opacity-60';

type Who = 'self' | 'guardian';

/**
 * *Convidar aluno* — somebody not yet on the register (Rui, 30-10-2026).
 *
 * It opens on one question, *Quem vai usar a app?* (POOLSE-218, Rui 10-11-2026),
 * because a parent's email in the student's own form made the parent's login the
 * child's. *O próprio aluno* is the old form: a name and a phone and/or email,
 * for students of 12 and over. *Um encarregado de educação* takes the child's
 * name and date of birth and the guardian's details, and invites the guardian.
 * Either way the link comes back, to send from the club's phone.
 */
export function InviteStudent({ organizationName }: { organizationName: string }): React.ReactElement {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState<Who>('self');
  const [state, action, pending] = useSavedAction(inviteNewStudentAction, INITIAL);
  // A new form after each invitation that worked, so the next one starts empty.
  const fresh = useSuccessKey(state);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => panel.current?.querySelector<HTMLInputElement>('input')?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [open]);

  const field = (...names: string[]): string | undefined => {
    for (const name of names) {
      const key = state.fields?.[name];
      if (key !== undefined) return t(key, state.values);
    }
    return undefined;
  };

  const card = (value: Who, title: string, hint: string): React.ReactElement => {
    const chosen = who === value;
    return (
      <label
        className={cn(
          'relative flex cursor-pointer flex-col gap-1 rounded border p-4 pr-10 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary',
          chosen ? 'border-primary bg-primary/10' : 'border-border bg-surface hover:bg-surface-muted',
        )}
      >
        <input
          type="radio"
          name="for"
          value={value}
          checked={chosen}
          onChange={() => setWho(value)}
          className="sr-only"
        />
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-sm text-foreground-muted">{hint}</span>
        {chosen && <Check aria-hidden className="absolute right-3 top-3 size-5 text-primary" />}
      </label>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="invite-student"
        onClick={() => setOpen((was) => !was)}
        className={`${BUTTON} self-start bg-primary text-primary-foreground hover:bg-primary/90 font-semibold`}
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
          className="flex flex-col gap-4 rounded bg-surface p-5 shadow-card"
        >
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold">{t('inviteStudent.title')}</h2>
            <p className="text-sm text-foreground-muted">{t('inviteStudent.intro')}</p>
          </div>

          <form key={`${fresh}:${who}`} action={action} className="flex flex-col gap-3">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold">{t('inviteStudent.who.question')}</legend>
              <div role="radiogroup" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {card('self', t('inviteStudent.who.self'), t('inviteStudent.who.selfHint'))}
                {card('guardian', t('inviteStudent.who.guardian'), t('inviteStudent.who.guardianHint'))}
              </div>
            </fieldset>

            {who === 'self' ? (
              <>
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
              </>
            ) : (
              <>
                <h3 className="text-sm font-semibold">{t('inviteStudent.child.heading')}</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <TextField name="firstName" label={t('inviteStudent.firstName')} required error={field('firstName')} />
                  <TextField name="lastName" label={t('inviteStudent.lastName')} required error={field('lastName')} />
                  <TextField
                    name="birthDate"
                    type="date"
                    label={t('inviteStudent.child.birthDate')}
                    required
                    error={field('birthDate')}
                  />
                </div>
                <h3 className="text-sm font-semibold">{t('inviteStudent.guardian.heading')}</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <TextField
                    name="guardianFirstName"
                    label={t('inviteStudent.firstName')}
                    required
                    error={field('guardianFirstName', 'guardianName')}
                  />
                  <TextField
                    name="guardianLastName"
                    label={t('inviteStudent.lastName')}
                    required
                    error={field('guardianLastName')}
                  />
                  <TextField
                    name="guardianRelationship"
                    label={t('inviteStudent.guardian.relationship')}
                    placeholder={t('inviteStudent.guardian.relationshipPlaceholder')}
                    required
                    maxLength={80}
                    error={field('guardianRelationship')}
                  />
                  <TextField
                    name="guardianEmail"
                    type="email"
                    autoComplete="off"
                    label={t('inviteStudent.email')}
                    error={field('guardianEmail')}
                  />
                  <TextField
                    name="guardianTaxNumber"
                    inputMode="numeric"
                    autoComplete="off"
                    label={t('inviteStudent.guardian.taxNumber')}
                    error={field('guardianTaxNumber')}
                  />
                  <TextField
                    name="guardianPhone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="off"
                    label={t('inviteStudent.phone')}
                    error={field('guardianPhone')}
                  />
                </div>
                <p className="text-sm text-foreground-muted">{t('inviteStudent.guardian.keyHint')}</p>
              </>
            )}

            {state.errorKey === 'inviteStudent.childNeedsGuardian' && (
              <p className="text-sm text-warning">
                {t('inviteStudent.childNeedsGuardian')}{' '}
                <button
                  type="button"
                  onClick={() => setWho('guardian')}
                  className="text-primary underline underline-offset-2"
                >
                  {t('inviteStudent.who.useGuardian')}
                </button>
              </p>
            )}
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
              <button type="submit" disabled={pending} className={`${BUTTON} bg-primary text-primary-foreground hover:bg-primary/90 font-semibold`}>
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

          {state.ok && state.covered !== undefined && (
            <p role="status" className="text-sm">
              {t(state.covered === 'has_login' ? 'inviteStudent.guardian.hasLogin' : 'inviteStudent.guardian.alreadyInvited')}
            </p>
          )}
          {state.ok && state.link !== undefined && (
            <ShareLink
              link={state.link}
              text={
                state.forGuardian === true
                  ? t('familyAccess.shareText', { club: organizationName, student: state.childFirstName ?? '' })
                  : t('familyAccess.shareTextSelf', { club: organizationName })
              }
            />
          )}
          {state.ok && state.studentId !== undefined && (
            <FromLink
              href={`/dashboard/students/${state.studentId}`}
              className="self-start text-sm text-primary underline-offset-2 hover:underline coarse:-my-3 coarse:py-3"
            >
              {t('inviteStudent.openRecord')}
            </FromLink>
          )}
        </div>
      </Reveal>
    </div>
  );
}
