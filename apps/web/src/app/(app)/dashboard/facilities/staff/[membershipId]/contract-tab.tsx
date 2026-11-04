'use client';

import { startTransition, useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FileSignature, Lock, Upload } from 'lucide-react';
import { DropOverlay, useFileDrop } from '@/components/file-drop';
import { DocumentLink } from '@/components/file-upload';
import { ConfirmButton } from '@/components/confirm-action';
import { SelectField, TextField } from '@/components/ui/field';
import { formatDate } from '@/lib/date-format';
import { acceptFor } from '@/lib/files';
import { useSavedAction } from '@/lib/saved';
import type { StaffContract, StaffContractKind } from '@/lib/api';
import type { FormState } from '../../../actions';
import { removeContractAction, saveContractFactsAction, uploadContractAction } from './contract.actions';

const KINDS: readonly StaffContractKind[] = ['open_ended', 'fixed_term', 'uncertain_term', 'services', 'internship'];
const INITIAL: FormState = { ok: false };

/**
 * *Contrato* — POOLSE-149 slice C. The signed contract, PDF or Word, dropped
 * anywhere on the screen or picked; earlier versions listed under it; and what
 * it says — kind, start, end — for reading only. Nothing in salaries or
 * vacations reads these (Rui, 02-11-2026).
 *
 * `canEdit` is the API's own answer, so the screen offers exactly what the
 * guard allows: the person reads theirs, and an Admin's own is the Owner's to
 * file.
 */
export function ContractTab({
  membershipId,
  contract,
  storageReady,
}: {
  membershipId: string;
  contract: StaffContract;
  storageReady: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const input = useRef<HTMLInputElement>(null);
  const [, upload, uploading] = useSavedAction(uploadContractAction, INITIAL);
  const [, remove, removing] = useSavedAction(removeContractAction, INITIAL);
  const [state, save, saving] = useSavedAction(saveContractFactsAction, INITIAL);
  const error = (field: string): { error?: string } =>
    state.fields?.[field] === undefined ? {} : { error: t(state.fields[field]) };
  const facts = contract.facts;
  const [kind, setKind] = useState<string>(facts?.kind ?? '');

  const send = useCallback(
    (file: File): void => {
      if (!storageReady || !contract.canEdit) return;
      const data = new FormData();
      data.set('membershipId', membershipId);
      data.set('file', file);
      startTransition(() => upload(data));
    },
    [contract.canEdit, membershipId, storageReady, upload],
  );
  const { dragging } = useFileDrop(send);

  return (
    <>
      <DropOverlay shown={dragging && storageReady && contract.canEdit} label={t('staffContract.drop')} />
      <section className="flex flex-col gap-3 rounded bg-surface p-5 shadow-card">
        <h2 className="flex items-center gap-1.5 font-medium">
          <FileSignature className="size-4" aria-hidden />
          {t('staffContract.document')}
        </h2>
        <p className="flex items-start gap-1.5 text-sm text-foreground-muted">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t('staffContract.visibility')}
        </p>

        {contract.current === null ? (
          <p className="text-sm text-foreground-muted">{t('staffContract.none')}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <DocumentLink
              fileId={contract.current.fileId}
              contentType={contract.current.contentType}
              fileName={contract.current.originalName}
            />
            <span className="text-sm text-foreground-muted">
              {t('staffContract.filedBy', {
                date: formatDate(contract.current.attachedAt.slice(0, 10)),
                name: contract.current.attachedByName ?? '—',
              })}
            </span>
          </div>
        )}

        {contract.canEdit && (
          <div className="flex flex-col items-start gap-1">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!storageReady || uploading}
                onClick={() => input.current?.click()}
                className="inline-flex h-control items-center justify-center gap-2 rounded-sm bg-surface px-4 text-control shadow-card hover:bg-surface-muted disabled:opacity-60"
              >
                <Upload className="size-4" aria-hidden />
                {uploading
                  ? t('staffContract.sending')
                  : contract.current === null
                    ? t('staffContract.upload')
                    : t('staffContract.replace')}
              </button>
              {contract.current !== null && (
                <form action={remove}>
                  <input type="hidden" name="membershipId" value={membershipId} />
                  {/* Asks first (Rui, 04-11-2026). */}
                  <ConfirmButton
                    title={t('confirm.equipa.contractRemoveTitle')}
                    message={t('confirm.equipa.contractRemoveMessage')}
                    confirmLabel={t('staffContract.remove')}
                    tone="danger"
                    disabled={removing}
                    className="inline-flex h-control items-center justify-center gap-2 rounded-sm bg-surface px-4 text-control text-foreground-muted shadow-card hover:text-danger disabled:opacity-60"
                  >
                    {t('staffContract.remove')}
                  </ConfirmButton>
                </form>
              )}
            </div>
            <input
              ref={input}
              type="file"
              className="hidden"
              aria-label={t('staffContract.upload')}
              accept={acceptFor('agreement_document')}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file !== undefined) send(file);
                event.target.value = '';
              }}
            />
            <span className="text-sm text-foreground-muted">
              {storageReady ? t('staffContract.hint') : t('files.notConfigured')}
            </span>
          </div>
        )}

        {contract.history.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-border pt-3">
            <h3 className="text-sm font-medium">{t('staffContract.history')}</h3>
            <ul className="flex flex-col gap-1">
              {contract.history.map((version) => (
                <li key={version.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <DocumentLink quiet fileId={version.fileId} contentType={version.contentType} fileName={version.originalName} />
                  <span className="text-foreground-muted">
                    {t('staffContract.filedBy', {
                      date: formatDate(version.attachedAt.slice(0, 10)),
                      name: version.attachedByName ?? '—',
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded bg-surface p-5 shadow-card">
        <h2 className="font-medium">{t('staffContract.facts')}</h2>
        <p className="text-sm text-foreground-muted">{t('staffContract.factsInformative')}</p>
        {contract.canEdit ? (
          <form action={save} className="flex flex-col gap-3">
            <input type="hidden" name="membershipId" value={membershipId} />
            <div className="grid gap-3 sm:grid-cols-3">
              <SelectField
                name="kind"
                label={t('staffContract.kind')}
                initial={facts?.kind ?? ''}
                onValueChange={setKind}
                options={[
                  { value: '', label: t('staffContract.notRecorded') },
                  ...KINDS.map((value) => ({ value, label: t(`staffContract.kinds.${value}`) })),
                ]}
                className="max-w-none"
                {...error('kind')}
              />
              <TextField
                name="startsOn"
                type="date"
                label={t('staffContract.startsOn')}
                initial={facts?.startsOn ?? ''}
                className="max-w-none"
                {...error('startsOn')}
              />
              <TextField
                name="endsOn"
                type="date"
                label={t('staffContract.endsOn')}
                initial={facts?.endsOn ?? ''}
                required={kind === 'fixed_term'}
                hint={kind === 'open_ended' ? t('staffContract.endsOnOpen') : undefined}
                className="max-w-none"
                {...error('endsOn')}
              />
            </div>
            <div>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex h-control items-center justify-center rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground disabled:opacity-60"
              >
                {t('staffContract.save')}
              </button>
            </div>
          </form>
        ) : (
          <dl className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ['kind', facts?.kind ? t(`staffContract.kinds.${facts.kind}`) : null],
                ['startsOn', facts?.startsOn ? formatDate(facts.startsOn) : null],
                ['endsOn', facts?.endsOn ? formatDate(facts.endsOn) : null],
              ] as const
            ).map(([field, value]) => (
              <div key={field} className="flex flex-col gap-1">
                <dt className="text-sm text-foreground-muted">{t(`staffContract.${field}`)}</dt>
                <dd>{value ?? '—'}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </>
  );
}
