'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Guardian } from '@/lib/api';
import { ageInYears } from '@/lib/ages';
import { TextField } from '@/components/ui/field';

/**
 * The encarregado de educação — POOLSE-04.
 *
 * **It appears and disappears live, and nothing typed is lost.** The whole block
 * stays mounted whatever the date of birth says; only its visibility changes. An
 * operator who mistypes 2010 as 1910, fills the block in, and then corrects the
 * year would otherwise watch six fields empty themselves — and React would have
 * done it silently, because unmounting throws state away.
 *
 * **Nothing is deleted when a student turns eighteen** (criterion 5). The block
 * collapses to a summary they can reopen, and the values still post, because
 * "who was your guardian" remains true about the years it covered. A form that
 * quietly stopped submitting fields it was still showing would be the worse of
 * the two surprises.
 *
 * **A missing date of birth shows nothing.** Most students have none after an
 * import, and demanding a guardian for somebody whose age nobody knows would
 * fail most rows.
 */
export function GuardianBlock({
  guardian,
  birthDateInputId,
  errors,
}: {
  guardian: Guardian | undefined;
  /** The date field elsewhere in the same form, watched for changes. */
  birthDateInputId: string;
  errors: Record<string, string> | undefined;
}): React.ReactElement {
  const t = useTranslations();

  const [birthDate, setBirthDate] = useState('');
  const [reopened, setReopened] = useState(false);

  /*
   * Heard from the date input rather than lifted into shared state, because it
   * sits several fields away and threading a value through everything between
   * them would couple the whole form to this one block.
   */
  useEffect(() => {
    const input = document.getElementById(birthDateInputId);
    if (!(input instanceof HTMLInputElement)) return;

    const read = (): void => setBirthDate(input.value);
    read();
    input.addEventListener('change', read);
    input.addEventListener('input', read);
    return () => {
      input.removeEventListener('change', read);
      input.removeEventListener('input', read);
    };
  }, [birthDateInputId]);

  const age = birthDate === '' ? null : ageInYears(birthDate);
  const minor = age !== null && age < 18;

  // Something already recorded is worth showing even for an adult — that is the
  // "retained but optional" the ticket asks for.
  const hasData = Object.values(guardian ?? {}).some((value) => value !== null && value !== '');
  const open = minor || reopened || (age === null && hasData);

  // Nothing to say: no date of birth, and nothing recorded.
  if (age === null && !hasData) return <></>;

  return (
    <section
      className="flex flex-col gap-4 rounded border border-border bg-surface-muted p-4"
      aria-labelledby="guardian-heading"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="guardian-heading" className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('students.guardian')}
        </h2>

        {!minor && hasData && (
          <button
            type="button"
            onClick={() => setReopened((current) => !current)}
            className="rounded text-sm text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {open ? t('students.guardianCollapse') : t('students.guardianExpand')}
          </button>
        )}
      </div>

      <p className="text-sm text-foreground-muted">
        {minor ? t('students.guardianRequiredHint') : t('students.guardianAdultHint')}
      </p>

      {/*
        Hidden rather than unmounted. Everything still posts, and correcting a
        mistyped year brings the block back with what was already filled in.
      */}
      <div className={open ? 'flex flex-col gap-4' : 'hidden'}>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            name="guardianName"
            label={t('students.guardianName')}
            initial={guardian?.name ?? ''}
            error={errors?.['guardianName'] === undefined ? undefined : t(errors['guardianName'])}
            autoComplete="name"
            maxLength={120}
          />
          <TextField
            name="guardianRelationship"
            label={t('students.guardianRelationship')}
            initial={guardian?.relationship ?? ''}
            placeholder={t('students.guardianRelationshipPlaceholder')}
            error={
              errors?.['guardianRelationship'] === undefined
                ? undefined
                : t(errors['guardianRelationship'])
            }
            maxLength={80}
          />
          <TextField
            name="guardianPhone"
            type="tel"
            label={t('students.guardianPhone')}
            initial={guardian?.phone ?? ''}
            error={errors?.['guardianPhone'] === undefined ? undefined : t(errors['guardianPhone'])}
            autoComplete="tel"
            maxLength={40}
          />
          <TextField
            name="guardianEmail"
            type="email"
            label={t('students.guardianEmail')}
            initial={guardian?.email ?? ''}
            error={errors?.['guardianEmail'] === undefined ? undefined : t(errors['guardianEmail'])}
            autoComplete="email"
            maxLength={254}
          />
          <TextField
            name="guardianTaxNumber"
            label={t('students.guardianTaxNumber')}
            initial={guardian?.taxNumber ?? ''}
            hint={t('students.optionalHint')}
            maxLength={20}
          />
          <TextField
            name="guardianAddress"
            label={t('students.guardianAddress')}
            initial={guardian?.address ?? ''}
            hint={t('students.optionalHint')}
            maxLength={500}
          />
        </div>
      </div>
    </section>
  );
}
