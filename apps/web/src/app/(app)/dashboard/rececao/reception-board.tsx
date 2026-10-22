'use client';

import { useState } from 'react';
import { FromLink } from '@/components/from-link';
import { useLocale, useTranslations } from 'next-intl';
import { LogOut, Ticket, Undo2, Waves } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import { Dialog } from '@/components/ui/dialog';
import { SelectField } from '@/components/ui/field';
import { formatCents } from '@/lib/money';
import { formatTime } from '@/lib/date-format';
import { PoolClosureNote } from '@/components/pool-closure-note';
import type { InWater, PoolOccupancy, Reception } from '@/lib/api';
import {
  cancelCheckInAction,
  checkOutAction,
  sellAction,
  type ReceptionState,
} from './reception.actions';
import { PersonDesk } from './person-desk';
import { BUTTON, BUTTON_QUIET, PANEL, PANEL_TITLE } from './styles';

const INITIAL: ReceptionState = { ok: false };

/**
 * The desk — POOLSE-68.
 *
 * **One tank is chosen at the top and every entry goes into it.** Reception
 * at a two-tank site is usually stood beside one of them; asking which on every
 * check-in is a question answered forty times an afternoon.
 *
 * **Nothing here is disabled to say no.** A pack with nothing left, a monthly
 * pass that ended, a full tank: the button is pressed and the refusal comes
 * back in words with its numbers, from the same trigger that would have
 * refused any other caller.
 */
export function ReceptionBoard({
  facilityId,
  reception,
}: {
  facilityId: string;
  reception: Reception;
}): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  // No tank until reception picks one (Rui, 12 October 2026) — an entry let
  // into the first tank by default is an entry counted in the wrong water. One
  // tank is no choice, so it is taken.
  const [poolId, setPoolId] = useState(
    reception.pools.length === 1 ? (reception.pools[0]?.poolId ?? '') : '',
  );

  if (reception.pools.length === 0) {
    return <p className="text-sm text-foreground-muted">{t('reception.noPools')}</p>;
  }

  const poolName = (id: string): string =>
    reception.pools.find((pool) => pool.poolId === id)?.poolName ?? '';

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="reception-water" className={PANEL}>
        <h2 id="reception-water" className={PANEL_TITLE}>
          {t('reception.occupancyTitle')}
        </h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {reception.pools.map((pool) => (
            <OccupancyCard key={pool.poolId} pool={pool} />
          ))}
        </ul>
        <p className="text-sm text-foreground-muted">
          {t('reception.stayNote', { minutes: reception.stayMinutes })}
        </p>
        {/* Free swim's own figure — never added to the mensalidades (AC 6). */}
        <p className="text-sm">
          {t('reception.month', {
            amount: formatCents(locale, reception.month.salesCents),
            sales: reception.month.sales,
            entries: reception.month.entries,
          })}
        </p>
      </section>

      {reception.pools.length > 1 && (
        <SelectField
          name="tank"
          label={t('reception.tank')}
          hint={t('reception.tankHint')}
          initial={poolId}
          onValueChange={setPoolId}
          options={[
            { value: '', label: t('reception.choosePool') },
            // A closed tank stays choosable — the refusal says why — but says so.
            ...reception.pools.map((pool) => ({
              value: pool.poolId,
              label:
                pool.closure === null
                  ? pool.poolName
                  : t('reception.closedOption', { pool: pool.poolName }),
            })),
          ]}
        />
      )}

      {reception.products.length === 0 ? (
        <p className="rounded border border-border bg-surface-muted p-4 text-sm text-foreground-muted">
          {t('reception.noProducts')}{' '}
          <FromLink
            // Straight to the Natação livre section, not the tab's first one.
            href={`/dashboard/facilities/${facilityId}?tab=prices&section=freeSwim`}
            className="text-primary underline underline-offset-2"
          >
            {t('reception.noProductsLink')}
          </FromLink>
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <QuickEntry facilityId={facilityId} reception={reception} poolId={poolId} />
          <PersonDesk
            facilityId={facilityId}
            products={reception.products}
            inWaterVersion={reception.inWater.map((row) => row.checkInId).join(',')}
            poolId={poolId}
            poolName={poolName(poolId)}
          />
        </div>
      )}

      <InWaterList facilityId={facilityId} inWater={reception.inWater} poolName={poolName} />
    </div>
  );
}

/**
 * One tank's occupancy, in words and as a bar.
 *
 * The bar is decoration — the sentence beside it carries every number, so
 * colour and length never carry the meaning alone. Over 90% reads in the
 * warning tone with an icon-free "quase cheio" in the text, because a full tank
 * is the thing reception most needs to see coming.
 */
function OccupancyCard({ pool }: { pool: PoolOccupancy }): React.ReactElement {
  const t = useTranslations();
  const occupied = pool.swimmers + pool.inClasses;
  const ratio = pool.capacity === null ? null : Math.min(occupied / pool.capacity, 1);
  const nearlyFull = ratio !== null && ratio >= 0.9;

  return (
    <li className="flex flex-col gap-2 rounded border border-border p-4">
      <p className="flex items-center gap-2 font-medium">
        <Waves aria-hidden className="size-4 shrink-0 text-primary" />
        {pool.poolName}
      </p>
      <p className={nearlyFull ? 'text-2xl font-semibold text-warning' : 'text-2xl font-semibold'}>
        {pool.capacity === null
          ? t('reception.occupiedNoCeiling', { occupied })
          : t('reception.occupiedOf', { occupied, capacity: pool.capacity })}
      </p>
      {ratio !== null && (
        <div aria-hidden className="h-2 w-full overflow-hidden rounded bg-surface-muted">
          <div
            className={nearlyFull ? 'h-full bg-warning' : 'h-full bg-primary'}
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </div>
      )}
      <p className="text-sm text-foreground-muted">
        {t('reception.breakdown', { swimmers: pool.swimmers, inClasses: pool.inClasses })}
        {nearlyFull && ` · ${t('reception.nearlyFull')}`}
        {pool.capacity === null && ` · ${t('reception.noCeiling')}`}
      </p>
      {/* Shut now: a check-in here is refused, and reception sees it first. */}
      <PoolClosureNote closure={pool.closure} />
    </li>
  );
}

/** An anonymous single entry, sold and let in with one press. */
function QuickEntry({
  facilityId,
  reception,
  poolId,
}: {
  facilityId: string;
  reception: Reception;
  poolId: string;
}): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const singles = reception.products.filter((product) => product.kind === 'single');
  const [state, submit, pending] = useSavedAction(sellAction, INITIAL);
  const fields = state.fields ?? {};

  return (
    <section aria-labelledby="reception-quick" className={PANEL}>
      <div className="flex items-start gap-3">
        <Ticket aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
        <div>
          <h2 id="reception-quick" className={PANEL_TITLE}>
            {t('reception.quickTitle')}
          </h2>
          <p className="mt-1 text-sm text-foreground-muted">{t('reception.quickHint')}</p>
        </div>
      </div>

      {singles.length === 0 ? (
        <p className="text-sm text-foreground-muted">{t('reception.noSingles')}</p>
      ) : poolId === '' ? (
        // Said rather than disabled: the entry has nowhere to go yet.
        <p className="text-sm text-foreground-muted">{t('reception.chooseTankFirst')}</p>
      ) : (
        <form action={submit} className="flex flex-col gap-3">
          <input type="hidden" name="facilityId" value={facilityId} />
          <input type="hidden" name="poolId" value={poolId} />
          <input type="hidden" name="checkIn" value="on" />
          <SelectField
            name="productId"
            label={t('reception.product')}
            initial={singles[0]!.id}
            options={singles.map((product) => ({
              value: product.id,
              label: `${product.name} — ${formatCents(locale, product.amountCents)}`,
            }))}
            error={fields['productId'] === undefined ? undefined : t(fields['productId'])}
          />
          <div>
            <button type="submit" disabled={pending} className={BUTTON}>
              {t('reception.sellAndEnter')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/**
 * Who is in the water on a pass — bounded by the default stay, so not paged.
 *
 * *Saída* records an early check-out; *Anular* takes back a check-in entered
 * by mistake, giving the entry back to the pack, and asks first.
 */
function InWaterList({
  facilityId,
  inWater,
  poolName,
}: {
  facilityId: string;
  inWater: InWater[];
  poolName: (id: string) => string;
}): React.ReactElement {
  const t = useTranslations();
  const [cancelling, setCancelling] = useState<InWater | null>(null);

  return (
    <section aria-labelledby="reception-in-water" className={PANEL}>
      <h2 id="reception-in-water" className={PANEL_TITLE}>
        {t('reception.inWaterTitle', { count: inWater.length })}
      </h2>

      {inWater.length === 0 ? (
        <p className="text-sm text-foreground-muted">{t('reception.inWaterNone')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {inWater.map((row) => (
            <li
              key={row.checkInId}
              className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="font-medium">{row.personName ?? t('reception.anonymous')}</p>
                <p className="text-sm text-foreground-muted">
                  {t('reception.inWaterLine', {
                    product: row.productName,
                    pool: poolName(row.poolId),
                    since: formatTime(row.checkedInAt),
                    until: formatTime(row.leavesAt),
                  })}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <CheckOutButton facilityId={facilityId} checkInId={row.checkInId} />
                <button type="button" onClick={() => setCancelling(row)} className={BUTTON_QUIET}>
                  <Undo2 aria-hidden className="size-4" />
                  {t('reception.cancel')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {cancelling !== null && (
        <CancelCheckIn
          facilityId={facilityId}
          row={cancelling}
          onDone={() => setCancelling(null)}
        />
      )}
    </section>
  );
}

function CheckOutButton({
  facilityId,
  checkInId,
}: {
  facilityId: string;
  checkInId: string;
}): React.ReactElement {
  const t = useTranslations();
  const [, submit, pending] = useSavedAction(checkOutAction, INITIAL);
  return (
    <form action={submit}>
      <input type="hidden" name="facilityId" value={facilityId} />
      <input type="hidden" name="checkInId" value={checkInId} />
      <button type="submit" disabled={pending} className={BUTTON_QUIET}>
        <LogOut aria-hidden className="size-4" />
        {t('reception.checkOut')}
      </button>
    </form>
  );
}

function CancelCheckIn({
  facilityId,
  row,
  onDone,
}: {
  facilityId: string;
  row: InWater;
  onDone: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [, submit, pending] = useSavedAction(
    async (previous: ReceptionState, formData: FormData) => {
      const next = await cancelCheckInAction(previous, formData);
      if (next.ok) onDone();
      return next;
    },
    INITIAL,
  );

  return (
    <Dialog
      open
      onClose={onDone}
      title={t('reception.cancelTitle')}
      description={row.personName ?? t('reception.anonymous')}
      closeLabel={t('reception.keep')}
    >
      <form action={submit} className="flex flex-col gap-4">
        <input type="hidden" name="facilityId" value={facilityId} />
        <input type="hidden" name="checkInId" value={row.checkInId} />
        <p className="text-sm">{t('reception.cancelAsk')}</p>
        <div className="flex gap-2">
          <button type="submit" disabled={pending} className={BUTTON}>
            {t('reception.cancel')}
          </button>
          <button type="button" onClick={onDone} className={BUTTON_QUIET}>
            {t('reception.keep')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
