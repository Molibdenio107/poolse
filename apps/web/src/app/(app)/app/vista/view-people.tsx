'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronRight } from 'lucide-react';
import { TextAreaField } from '@/components/ui/field';
import { startViewAction } from './view.actions';

/**
 * The people of a home — POOLSE-188. Picking one opens the view; nothing is
 * chosen and then confirmed, because leaving is one press of *Sair*. Support
 * says why first, and the API refuses a view without a reason.
 */
export function ViewPeople({
  hat,
  people,
  support,
}: {
  hat: string;
  people: { membershipId: string; name: string }[];
  support: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [reason, setReason] = useState('');
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [fieldKey, setFieldKey] = useState<string | undefined>(undefined);
  const [pending, start] = useTransition();

  function open(membershipId: string): void {
    setErrorKey(null);
    setFieldKey(undefined);
    start(async () => {
      const state = await startViewAction(hat, membershipId, reason);
      setFieldKey(state.fields?.['reason']);
      if (state.fields?.['reason'] === undefined) setErrorKey(state.errorKey ?? null);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {support && (
        <TextAreaField
          name="reason"
          label={t('appView.reason')}
          hint={t('appView.reasonHint')}
          rows={2}
          maxLength={500}
          required
          {...(fieldKey === undefined ? {} : { error: t(fieldKey) })}
          onValueChange={setReason}
        />
      )}
      {errorKey !== null && (
        <p role="alert" className="text-sm text-destructive-ink">
          {t(errorKey)}
        </p>
      )}
      <ul className="flex flex-col divide-y divide-border">
        {people.map((person) => (
          <li key={person.membershipId}>
            <button
              type="button"
              disabled={pending}
              onClick={() => open(person.membershipId)}
              className="flex min-h-[52px] w-full items-center justify-between gap-3 py-2 text-left disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span className="min-w-0 truncate">{person.name}</span>
              <ChevronRight className="size-4 shrink-0 text-foreground-muted" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
