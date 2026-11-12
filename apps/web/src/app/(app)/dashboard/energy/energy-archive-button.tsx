'use client';

import { useTranslations } from 'next-intl';
import { Archive } from 'lucide-react';
import { ConfirmButton } from '@/components/confirm-action';
import { ARCHIVE_ICON, ARCHIVE_TRIGGER } from '@/lib/archive-trigger';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '../actions';
import { archiveEnergyAction } from './history.actions';

const INITIAL: FormState = { ok: false };

/**
 * Apagar — energy readings or bills, one or what a list shows (Rui,
 * 12-11-2026). Owner and Admin only, asked first, every one restorable from
 * Arquivados. The caller says what, and names the scope in words for the
 * question ("do Contador geral em novembro de 2026").
 */
export function EnergyArchiveButton(
  props:
    | { what: 'batch'; kind: 'readings' | 'invoices'; meterId: string | null; month: string | null; count: number; scope: string }
    | { what: 'reading'; meterId: string; takenAt: string }
    | { what: 'invoice'; meterId: string; invoiceId: string; name: string },
): React.ReactElement {
  const t = useTranslations();
  const [, action, pending] = useSavedAction(archiveEnergyAction, INITIAL);
  const batch = props.what === 'batch';

  const title =
    props.what === 'batch'
      ? t(`energy.historyList.archive.${props.kind}.title`)
      : t(`energy.historyList.archive.${props.what}.title`);
  const message =
    props.what === 'batch'
      ? t(`energy.historyList.archive.${props.kind}.message`, { count: props.count, scope: props.scope })
      : props.what === 'invoice'
        ? t('energy.historyList.archive.invoice.message', { name: props.name })
        : t('energy.historyList.archive.reading.message');

  return (
    <form action={action} className="inline">
      <input type="hidden" name="what" value={props.what} />
      <input type="hidden" name="meterId" value={props.meterId ?? ''} />
      {props.what === 'batch' && (
        <>
          <input type="hidden" name="kind" value={props.kind} />
          <input type="hidden" name="month" value={props.month ?? ''} />
        </>
      )}
      {props.what === 'reading' && <input type="hidden" name="takenAt" value={props.takenAt} />}
      {props.what === 'invoice' && <input type="hidden" name="invoiceId" value={props.invoiceId} />}
      <ConfirmButton
        title={title}
        message={message}
        confirmLabel={t('common.remove')}
        tone="danger"
        disabled={pending}
        {...(batch ? {} : { ariaLabel: title })}
        className={batch ? ARCHIVE_TRIGGER : `${ARCHIVE_TRIGGER} w-control`}
      >
        <Archive aria-hidden className={ARCHIVE_ICON} />
        {props.what === 'batch' && t(`energy.historyList.archive.${props.kind}.button`)}
      </ConfirmButton>
    </form>
  );
}
