'use client';

import { useTranslations } from 'next-intl';
import { ConfirmAction } from '@/components/confirm-action';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '@/app/(app)/dashboard/actions';
import { answerConsentAction } from './consents.actions';

const INITIAL: FormState = { ok: false };

/**
 * *Autorizações* — POOLSE-208 rule 1. What a parent signed before the reader
 * turned 18, to confirm or withdraw. Short words, as the family app says the
 * least it can; *Retirar* asks first, because a photo comes down at once.
 */
export function ConsentsToConfirm({ consents }: { consents: { id: string; kind: string }[] }): React.ReactElement {
  const t = useTranslations();
  const [, action, pending] = useSavedAction(answerConsentAction, INITIAL);
  return (
    <section className="flex flex-col gap-2 rounded bg-surface p-4 shadow-card">
      <h2 className="text-sm font-semibold">{t('app.consents.title')}</h2>
      <ul className="flex flex-col divide-y divide-border">
        {consents.map((consent) => (
          <li key={consent.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
            <div>
              <p className="font-medium">{t(`app.consents.kind.${consent.kind}`)}</p>
              <p className="text-sm text-foreground-muted">{t('app.consents.byParent')}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <form action={action}>
                <input type="hidden" name="consentId" value={consent.id} />
                <input type="hidden" name="answer" value="confirm" />
                <button
                  type="submit"
                  disabled={pending}
                  className="inline-flex h-control items-center rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {t('app.consents.confirm')}
                </button>
              </form>
              <ConfirmAction
                action={action}
                pending={pending}
                fields={{ consentId: consent.id, answer: 'withdraw' }}
                title={t('app.consents.withdrawTitle')}
                message={t('app.consents.withdrawMessage')}
                confirmLabel={t('app.consents.withdraw')}
                trigger={t('app.consents.withdraw')}
                triggerClassName="inline-flex h-control items-center rounded-sm border border-border-strong px-4 text-control"
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
