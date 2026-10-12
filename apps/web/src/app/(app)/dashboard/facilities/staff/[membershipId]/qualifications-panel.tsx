'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AttachedDocument } from '@/components/file-upload';
import { QualificationStatus } from '@/components/qualification-status';
import { SelectField, TextField } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { formatDate } from '@/lib/date-format';
import { useSavedAction } from '@/lib/saved';
import type { PersonQualifications, QualificationType } from '@/lib/api';
import type { FormState } from '../../../actions';
import {
  addQualificationAction,
  archiveQualificationAction,
} from '../qualifications/qualifications.actions';

/**
 * A person's qualifications — POOLSE-27, 7b.2, the *Qualificações* tab.
 *
 * Their standing per type first, because that is the answer somebody opens the
 * tab for; then, for management, the form to file one; then the history, which
 * is every record ever filed, archived ones included and saying so.
 *
 * **The expiry is suggested, never imposed**: picking a type with a default
 * validity and an issue date fills the expiry, which stays editable — a TPTD
 * renewed early does not lapse on the anniversary of the old one.
 *
 * The document upload is present and visibly disabled until file storage
 * lands — the settled rule for every upload in the product.
 */

/** `issuedOn` plus `months`, as `YYYY-MM-DD`, or '' if either is missing. */
function suggestExpiry(issuedOn: string, months: number | null): string {
  if (months === null || !/^\d{4}-\d{2}-\d{2}$/.test(issuedOn)) return '';
  const [y, m, d] = issuedOn.split('-').map(Number) as [number, number, number];
  // Clamped to the target month's last day: 31-08 plus six months is 28-02,
  // not 03-03, and 29-02 plus a year is 28-02.
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  const date = new Date(Date.UTC(y, m - 1 + months, Math.min(d, last)));
  return date.toISOString().slice(0, 10);
}

export function QualificationsPanel({
  organizationId,
  membershipId,
  data,
  types,
  storageReady,
}: {
  organizationId: string;
  membershipId: string;
  data: PersonQualifications;
  /** Only for management: the form's options. */
  types: QualificationType[];
  /** Whether file storage is configured — the certificate control says so if not. */
  storageReady: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  const [state, dispatch, saving] = useSavedAction<FormState, FormData>(
    addQualificationAction.bind(null, organizationId, membershipId),
    { ok: false },
  );

  const [typeId, setTypeId] = useState(types[0]?.id ?? '');
  const [issuedOn, setIssuedOn] = useState('');

  /*
   * A saved record empties the form — October 2026 sweep. The fields are
   * controlled and their `initial` never changes, so they kept what was typed
   * after "Guardado", and a second click filed the same certificate twice.
   */
  const [formKey, setFormKey] = useState(0);
  const seen = useRef(state);
  useEffect(() => {
    if (seen.current === state) return;
    seen.current = state;
    if (state.ok) {
      setFormKey((key) => key + 1);
      setTypeId(types[0]?.id ?? '');
      setIssuedOn('');
    }
  }, [state, types]);
  const validity = types.find((type) => type.id === typeId)?.defaultValidityMonths ?? null;
  const suggested = suggestExpiry(issuedOn, validity);

  const fieldError = (name: string): string | undefined => {
    const key = state.fields?.[name];
    return key === undefined ? undefined : t(key as never);
  };

  const archive = (qualificationId: string): void => {
    startTransition(async () => {
      const result = await archiveQualificationAction(organizationId, membershipId, qualificationId);
      if (result.ok) {
        toast.show('success', t('qualifications.archived'));
        router.refresh();
      } else {
        toast.show('danger', t((result.errorKey ?? 'qualifications.error.archiveFailed') as never));
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
        <h2 className="font-medium">{t('qualifications.standing')}</h2>
        {data.standings.length === 0 ? (
          <p className="text-sm text-foreground-muted">{t('qualifications.noneOnFile')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {data.standings.map((standing) => (
              <li
                key={standing.typeId}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0"
              >
                <span className="flex flex-col">
                  <span>{standing.typeName}</span>
                  {standing.issuingBody !== null && (
                    <span className="text-sm text-foreground-muted">{standing.issuingBody}</span>
                  )}
                </span>
                <QualificationStatus status={standing.status} expiresOn={standing.expiresOn} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.canManage && (
        <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
          <h2 className="font-medium">{t('qualifications.add')}</h2>
          {types.length === 0 ? (
            <p className="text-sm text-foreground-muted">{t('qualifications.noTypes')}</p>
          ) : (
            <form key={formKey} action={dispatch} className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-4">
                <SelectField
                  name="typeId"
                  label={t('qualifications.field.type')}
                  initial={typeId}
                  options={types.map((type) => ({ value: type.id, label: type.name }))}
                  onValueChange={setTypeId}
                  error={fieldError('typeId')}
                />
                <TextField
                  name="issuingBody"
                  label={t('qualifications.field.issuingBody')}
                  maxLength={200}
                  error={fieldError('issuingBody')}
                />
              </div>
              <div className="flex flex-wrap gap-4">
                <TextField
                  name="issuedOn"
                  type="date"
                  label={t('qualifications.field.issuedOn')}
                  onValueChange={setIssuedOn}
                  error={fieldError('issuedOn')}
                />
                <TextField
                  name="expiresOn"
                  type="date"
                  label={t('qualifications.field.expiresOn')}
                  initial={suggested}
                  hint={
                    validity === null
                      ? t('qualifications.field.expiresHint')
                      : t('qualifications.field.expiresSuggested', { months: validity })
                  }
                  error={fieldError('expiresOn')}
                />
              </div>
              {/* The scan is attached to the record once it exists, below. */}
              <p className="text-sm text-foreground-muted">{t('files.certificateAfterSave')}</p>
              <div>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded bg-primary text-primary-foreground disabled:opacity-60"
                >
                  {t('qualifications.save')}
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      {data.history.length > 0 && (
        <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
          <h2 className="font-medium">{t('qualifications.history')}</h2>
          <ul className="flex flex-col divide-y divide-border text-sm">
            {data.history.map((record) => (
              <li
                key={record.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0"
              >
                <span className="flex flex-col">
                  <span className={record.archived ? 'text-foreground-muted line-through' : undefined}>
                    {record.typeName}
                    {record.issuingBody !== null && ` · ${record.issuingBody}`}
                  </span>
                  <span className="text-foreground-muted">
                    {record.expiresOn === null
                      ? t('qualifications.historyLineNoExpiry', {
                          issued: record.issuedOn === null ? '—' : formatDate(record.issuedOn),
                        })
                      : t('qualifications.historyLine', {
                          issued: record.issuedOn === null ? '—' : formatDate(record.issuedOn),
                          expires: formatDate(record.expiresOn),
                        })}
                    {record.archived && ` · ${t('qualifications.archivedLabel')}`}
                  </span>
                  {/* The certificate — attached once (12 October 2026). The
                      person it certifies sees the link too. */}
                  <span className="mt-1">
                    <AttachedDocument
                      fileId={record.documentFileId}
                      target={`qualification:${record.id}`}
                      canManage={data.canManage && !record.archived}
                      storageReady={storageReady}
                      once
                    />
                  </span>
                </span>
                {data.canManage && !record.archived && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => archive(record.id)}
                    className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded border border-border hover:bg-surface-muted disabled:opacity-60"
                  >
                    {t('qualifications.archive')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
