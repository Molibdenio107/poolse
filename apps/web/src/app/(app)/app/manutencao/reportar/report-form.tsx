'use client';

import { useTranslations } from 'next-intl';
import { SelectField, TextAreaField } from '@/components/ui/field';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '../../../dashboard/actions';
import { reportAction } from '../maintenance.actions';

const INITIAL: FormState = { ok: false };

/**
 * The backoffice's own issue report (`POST /spaces/:id/issues`) in four fields:
 * where, what kind, how bad, what. Controlled fields, so a refusal keeps what
 * was typed; a success goes back to the to-do list.
 */
export function ReportForm({ spaces }: { spaces: { value: string; label: string }[] }): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(reportAction, INITIAL);
  const error = (field: string): { error?: string } =>
    state.fields?.[field] === undefined ? {} : { error: t(state.fields[field]) };

  return (
    <form action={action} className="flex flex-col gap-3">
      <SelectField
        name="spaceId"
        label={t('app.maintenance.where')}
        options={[{ value: '', label: t('app.maintenance.chooseSpace') }, ...spaces]}
        {...error('spaceId')}
      />
      <SelectField
        name="type"
        label={t('spaces.issueTypeLabel')}
        initial="fault"
        options={[
          { value: 'fault', label: t('spaces.issueType.fault') },
          { value: 'restock', label: t('spaces.issueType.restock') },
        ]}
        {...error('type')}
      />
      <SelectField
        name="severity"
        label={t('spaces.severity.label')}
        initial="normal"
        options={(['low', 'normal', 'high'] as const).map((value) => ({ value, label: t(`spaces.severity.${value}`) }))}
        {...error('severity')}
      />
      <TextAreaField name="description" label={t('spaces.issueDescription')} rows={3} {...error('description')} />
      <div
        data-bottom-bar
        className="sticky bottom-0 -mx-4 border-t border-border bg-background px-4 py-2 pb-[calc(0.5rem+var(--safe-bottom))] md:static md:mx-0 md:border-0 md:p-0"
      >
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-control w-full items-center justify-center rounded bg-primary px-4 text-control font-medium text-primary-foreground disabled:opacity-60 md:w-auto"
        >
          {t('app.maintenance.send')}
        </button>
      </div>
    </form>
  );
}
