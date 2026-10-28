'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy } from 'lucide-react';
import { formatIban, formatMbwayPhone } from '@poolse/rules';
import type { PaymentDestinations as Destinations } from '@/lib/api';

/**
 * Where to pay the club — POOLSE-94. The one rendering of it on the web, read
 * by a family's fee tab and by app mode's fee card; the reminder email says the
 * same things in the same order (transfer, MB WAY, the reference, the club's own
 * words), from the API's plain-text twin.
 *
 * Each number carries a copy button, because a parent types an IBAN into a
 * banking app on the same phone, and a 25-character string retyped is a
 * transfer to nobody. The number stays visible and selectable either way: a
 * blocked clipboard costs a convenience, never the information.
 *
 * `references` is one per child — the documents still open, else the child's
 * name; with one child it is unlabelled.
 */
export function PaymentDestinations({
  destinations,
  references,
}: {
  destinations: Destinations;
  references: { label?: string | undefined; reference: string }[];
}): React.ReactElement {
  const t = useTranslations();
  const payable = destinations.iban !== null || destinations.mbwayPhone !== null;

  return (
    <div className="flex flex-col gap-2 rounded bg-surface-muted p-4 text-sm">
      <p className="font-medium">{t('payTo.title')}</p>
      <dl className="flex flex-col gap-2">
        {destinations.iban !== null && (
          <div className="flex flex-col gap-0.5">
            <dt className="text-foreground-muted">{t('payTo.transfer')}</dt>
            <dd className="flex flex-wrap items-center gap-x-2">
              <span className="font-mono tabular-nums">{formatIban(destinations.iban)}</span>
              <CopyButton value={destinations.iban} label={t('payTo.copyIban')} />
            </dd>
            {destinations.accountHolder !== null && (
              <dd className="text-foreground-muted">{t('payTo.holder', { name: destinations.accountHolder })}</dd>
            )}
          </div>
        )}
        {destinations.mbwayPhone !== null && (
          <div className="flex flex-col gap-0.5">
            <dt className="text-foreground-muted">{t('payTo.mbway')}</dt>
            <dd className="flex flex-wrap items-center gap-x-2">
              <span className="tabular-nums">{formatMbwayPhone(destinations.mbwayPhone)}</span>
              <CopyButton value={destinations.mbwayPhone} label={t('payTo.copyMbway')} />
            </dd>
          </div>
        )}
        {payable &&
          references.map((entry) => (
            <div key={entry.label ?? entry.reference} className="flex flex-col gap-0.5">
              <dt className="text-foreground-muted">
                {entry.label === undefined ? t('payTo.reference') : t('payTo.referenceFor', { name: entry.label })}
              </dt>
              <dd className="flex flex-wrap items-center gap-x-2">
                <span className="font-medium">{entry.reference}</span>
                <CopyButton value={entry.reference} label={t('payTo.copyReference')} />
              </dd>
            </div>
          ))}
      </dl>
      {destinations.instructions !== null && (
        <p className="whitespace-pre-line text-foreground-muted">{destinations.instructions}</p>
      )}
    </div>
  );
}

/** A value copied in one tap; the value itself stays visible. Also the results address's (POOLSE-114). */
export function CopyButton({ value, label }: { value: string; label: string }): React.ReactElement {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={label}
      className="inline-flex h-control items-center justify-center gap-1.5 rounded px-4 text-control text-primary hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
      <span aria-live="polite">{copied ? t('common.copied') : t('common.copy')}</span>
    </button>
  );
}
