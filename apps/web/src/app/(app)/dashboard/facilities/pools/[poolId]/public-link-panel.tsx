'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { CONTROL_LINE } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { formatStamp } from '@/lib/date-format';
import type { FormState } from '../../../actions';
import { issuePublicLinkAction, revokePublicLinkAction } from './public-link.actions';

/**
 * The *Página pública* tab — POOLSE-71.
 *
 * Off, it is one button. On, it is the link, the QR to print and two things that
 * kill the printed QR: switching the page off and making a new link. Both ask
 * first, in words that say the paper on the wall will stop working — that is the
 * consequence somebody is about to cause, and it is not visible from this screen.
 *
 * The QR is drawn on the server and arrives as a PNG and an SVG, so nothing here
 * encodes anything; the link is retrievable by design (decisions, 11-10-2026), so
 * reprinting never needs a new one.
 */

export interface PublicLinkView {
  url: string | null;
  createdAt: string | null;
  png: string | null;
  svg: string | null;
}

const BUTTON = 'rounded border border-border px-3 py-1.5 text-sm hover:bg-surface-muted disabled:opacity-60';
const PRIMARY = 'rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60';

export function PublicLinkPanel({
  organizationId,
  poolId,
  poolName,
  link,
}: {
  organizationId: string;
  poolId: string;
  poolName: string;
  link: PublicLinkView;
}): React.ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [asking, setAsking] = useState<'replace' | 'off' | null>(null);
  const confirm = useRef<HTMLButtonElement>(null);

  const run = (work: () => Promise<FormState>, success: string): void => {
    startTransition(async () => {
      const result = await work();
      setAsking(null);
      if (result.ok) {
        toast.show('success', success);
        router.refresh();
      } else {
        toast.show('danger', t((result.errorKey ?? 'publicWater.manage.error') as never));
      }
    });
  };

  // "Piscina Olímpica" → piscina-olimpica, not piscina-ol-mpica.
  const file = poolName
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'piscina';

  return (
    <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium">{t('publicWater.manage.title')}</h2>
        <p className="text-sm text-foreground-muted">{t('publicWater.manage.explain')}</p>
      </div>

      {link.url === null ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm">{t('publicWater.manage.off')}</p>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(
                () => issuePublicLinkAction(organizationId, poolId, false),
                t('publicWater.manage.turnedOn'),
              )
            }
            className={PRIMARY}
          >
            {t('publicWater.manage.turnOn')}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm">
            {t('publicWater.manage.on', { since: formatStamp(link.createdAt) })}
          </p>

          <div className="flex flex-wrap items-start gap-6">
            {link.png !== null && (
              // A data URL drawn on the server — `next/image` has nothing to optimise.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={link.png}
                alt={t('publicWater.manage.qrAlt', { pool: poolName })}
                width={192}
                height={192}
                className="rounded border border-border bg-white p-2"
              />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-foreground-muted">{t('publicWater.manage.link')}</span>
                <input
                  readOnly
                  value={link.url}
                  onFocus={(event) => event.currentTarget.select()}
                  className={`${CONTROL_LINE} w-full font-mono`}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={BUTTON}
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(link.url ?? '')
                      .then(() => toast.show('success', t('publicWater.manage.copied')))
                      .catch(() => toast.show('danger', t('publicWater.manage.copyFailed')));
                  }}
                >
                  {t('publicWater.manage.copy')}
                </button>
                <a href={link.url} target="_blank" rel="noopener" className={BUTTON}>
                  {t('publicWater.manage.open')}
                </a>
                <a href={`${link.url}?screen=1`} target="_blank" rel="noopener" className={BUTTON}>
                  {t('publicWater.manage.openScreen')}
                </a>
              </div>
              <div className="flex flex-wrap gap-2">
                {link.png !== null && (
                  <a href={link.png} download={`agua-${file}.png`} className={BUTTON}>
                    {t('publicWater.manage.downloadPng')}
                  </a>
                )}
                {link.svg !== null && (
                  <a
                    href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(link.svg)}`}
                    download={`agua-${file}.svg`}
                    className={BUTTON}
                  >
                    {t('publicWater.manage.downloadSvg')}
                  </a>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <button type="button" disabled={pending} onClick={() => setAsking('replace')} className={BUTTON}>
              {t('publicWater.manage.replace')}
            </button>
            <button type="button" disabled={pending} onClick={() => setAsking('off')} className={BUTTON}>
              {t('publicWater.manage.turnOff')}
            </button>
          </div>
        </div>
      )}

      <Dialog
        open={asking !== null}
        onClose={() => setAsking(null)}
        title={
          asking === 'off' ? t('publicWater.manage.turnOffTitle') : t('publicWater.manage.replaceTitle')
        }
        description={t('publicWater.manage.killsQr')}
        closeLabel={t('common.close')}
        initialFocus={confirm}
      >
        <div className="flex flex-wrap justify-end gap-2 text-sm">
          <button type="button" onClick={() => setAsking(null)} className={BUTTON}>
            {t('common.cancel')}
          </button>
          <button
            ref={confirm}
            type="button"
            disabled={pending}
            className={PRIMARY}
            onClick={() =>
              asking === 'off'
                ? run(
                    () => revokePublicLinkAction(organizationId, poolId),
                    t('publicWater.manage.turnedOff'),
                  )
                : run(
                    () => issuePublicLinkAction(organizationId, poolId, true),
                    t('publicWater.manage.replaced'),
                  )
            }
          >
            {asking === 'off' ? t('publicWater.manage.turnOff') : t('publicWater.manage.replace')}
          </button>
        </div>
      </Dialog>
    </section>
  );
}
