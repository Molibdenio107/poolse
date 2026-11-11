'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { LogIn, Search, UserPlus, X } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import { SelectField, TextField } from '@/components/ui/field';
import { formatCents } from '@/lib/money';
import { formatDate } from '@/lib/date-format';
import type { Pass, PassProduct, PersonPrice, PersonSummary, Swimmer } from '@/lib/api';
import {
  checkInAction,
  passesOf,
  pricesOf,
  searchPeople,
  sellAction,
  walkInAction,
  type ReceptionState,
} from './reception.actions';
import { BUTTON, BUTTON_QUIET, PANEL, PANEL_TITLE } from './styles';
import { today as todayOfClub } from '@/lib/dates';
import { PersonCategoriesCard } from '@/components/person-categories-card';
import { ageInYears } from '@/lib/ages';

const INITIAL: ReceptionState = { ok: false };

interface Chosen {
  membershipId: string;
  name: string;
}

/**
 * Somebody reception knows — find them, see their passes, let them in, or sell
 * them a new one. A walk-in seen for the first time is added here with a name
 * and, ideally, an email or NIF so the next visit finds them.
 */
export function PersonDesk({
  facilityId,
  products,
  ageOfMajority,
  inWaterVersion,
  poolId,
  poolName,
}: {
  facilityId: string;
  products: PassProduct[];
  /** The club's maioridade: under it, Nova pessoa asks for the encarregado. */
  ageOfMajority: number;
  /** Changes whenever the board's in-water list does — a check-out or a cancel there. */
  inWaterVersion: string;
  poolId: string;
  poolName: string;
}): React.ReactElement {
  const t = useTranslations();
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <section aria-labelledby="reception-person" className={PANEL}>
      <h2 id="reception-person" className={PANEL_TITLE}>
        {t('reception.personTitle')}
      </h2>

      {chosen === null ? (
        adding ? (
          <WalkInForm
            facilityId={facilityId}
            ageOfMajority={ageOfMajority}
            onCreated={(person) => {
              setAdding(false);
              setChosen(person);
            }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <>
            <PersonSearch onPick={setChosen} />
            <div>
              <button type="button" onClick={() => setAdding(true)} className={BUTTON_QUIET}>
                <UserPlus aria-hidden className="size-4" />
                {t('reception.newPerson')}
              </button>
            </div>
          </>
        )
      ) : (
        <>
        <PersonPasses
          facilityId={facilityId}
          person={chosen}
          inWaterVersion={inWaterVersion}
          products={products}
          poolId={poolId}
          poolName={poolName}
          onClear={() => setChosen(null)}
        />
        {/* POOLSE-202: the person's categories, an expired one said as a line. */}
        <PersonCategoriesCard key={chosen.membershipId} person={{ membershipId: chosen.membershipId }} className="shadow-none p-0" />
        </>
      )}
    </section>
  );
}

/**
 * Two characters before anything is asked, like every person search here. A
 * failed search says so and offers to try again — an empty list would read as
 * "nobody by that name", which is a different fact.
 */
function PersonSearch({ onPick }: { onPick: (person: Chosen) => void }): React.ReactElement {
  const t = useTranslations();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PersonSummary[] | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'failed' | 'done'>('idle');

  const run = useCallback(async (text: string) => {
    setState('loading');
    const found = await searchPeople(text);
    if (found === null) {
      setState('failed');
      return;
    }
    setResults(found);
    setState('done');
  }, []);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setResults(null);
      setState('idle');
      return;
    }
    const timer = setTimeout(() => void run(text), 250);
    return () => clearTimeout(timer);
  }, [query, run]);

  return (
    <div className="flex flex-col gap-3">
      <TextField
        name="personSearch"
        label={t('reception.search')}
        hint={t('reception.searchHint')}
        initial={query}
        onValueChange={setQuery}
        autoComplete="off"
        className="max-w-none"
      />

      {state === 'loading' && (
        <p className="text-sm text-foreground-muted">{t('reception.searching')}</p>
      )}
      {state === 'failed' && (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger">
          {t('reception.searchFailed')}
          <button
            type="button"
            onClick={() => void run(query.trim())}
            className={BUTTON_QUIET}
          >
            {t('reception.retry')}
          </button>
        </p>
      )}
      {state === 'done' && results !== null && results.length === 0 && (
        <p className="text-sm text-foreground-muted">{t('reception.noMatches')}</p>
      )}
      {state === 'done' && results !== null && results.length > 0 && (
        <ul className="divide-y divide-border rounded border border-border">
          {results.map((person) => (
            <li key={person.membershipId}>
              <button
                type="button"
                onClick={() => onPick({ membershipId: person.membershipId, name: person.name })}
                className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span className="flex items-center gap-2 font-medium">
                  <Search aria-hidden className="size-4 text-foreground-muted" />
                  {person.name}
                </span>
                {(person.email ?? person.taxNumber) !== null && (
                  <span className="text-sm text-foreground-muted">
                    {[person.email, person.taxNumber].filter(Boolean).join(' · ')}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WalkInForm({
  facilityId,
  ageOfMajority,
  onCreated,
  onCancel,
}: {
  facilityId: string;
  ageOfMajority: number;
  onCreated: (person: Chosen) => void;
  onCancel: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [birthDate, setBirthDate] = useState('');
  // A child at the desk (Rui, 11-11-2026): the encarregado is asked, and the server refuses without one.
  const age = birthDate === '' ? null : ageInYears(birthDate);
  const minor = age !== null && age < ageOfMajority;
  const [state, submit, pending] = useSavedAction(
    async (previous: ReceptionState, formData: FormData) => {
      const next = await walkInAction(previous, formData);
      if (next.ok && next.membershipId !== undefined) {
        onCreated({ membershipId: next.membershipId, name: `${first} ${last}`.trim() });
      }
      return next;
    },
    INITIAL,
  );
  const fields = state.fields ?? {};
  const error = (name: string): string | undefined =>
    fields[name] === undefined ? undefined : t(fields[name]);

  return (
    <form action={submit} className="flex flex-col gap-3">
      <input type="hidden" name="facilityId" value={facilityId} />
      <p className="text-sm text-foreground-muted">{t('reception.newPersonHint')}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField
          name="firstName"
          label={t('reception.firstName')}
          initial={first}
          onValueChange={setFirst}
          error={error('firstName')}
          required
          className="max-w-none"
        />
        <TextField
          name="lastName"
          label={t('reception.lastName')}
          initial={last}
          onValueChange={setLast}
          error={error('lastName')}
          required
          className="max-w-none"
        />
        <TextField
          name="email"
          type="email"
          label={t('reception.email')}
          error={error('email')}
          className="max-w-none"
        />
        <TextField
          name="phone"
          type="tel"
          inputMode="tel"
          label={t('reception.phone')}
          className="max-w-none"
        />
        <TextField
          name="taxNumber"
          inputMode="numeric"
          label={t('reception.taxNumber')}
          error={error('taxNumber')}
          className="max-w-none"
        />
        <TextField
          name="birthDate"
          type="date"
          label={t('reception.birthDate')}
          initial={birthDate}
          onValueChange={setBirthDate}
          error={error('birthDate')}
          className="max-w-none"
        />
      </div>
      {minor && (
        <fieldset className="flex flex-col gap-3 rounded border border-border p-3">
          <legend className="px-1 text-sm font-medium">{t('reception.guardianTitle')}</legend>
          <p className="text-sm text-foreground-muted">{t('reception.guardianHint', { age: ageOfMajority })}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField
              name="guardianName"
              label={t('students.guardianName')}
              error={error('guardianName')}
              required
              className="max-w-none"
            />
            <TextField
              name="guardianRelationship"
              label={t('students.guardianRelationship')}
              placeholder={t('students.guardianRelationshipPlaceholder')}
              error={error('guardianRelationship')}
              required
              className="max-w-none"
            />
            <TextField
              name="guardianPhone"
              type="tel"
              inputMode="tel"
              label={t('reception.guardianPhone')}
              error={error('guardianPhone')}
              className="max-w-none"
            />
            <TextField
              name="guardianEmail"
              type="email"
              label={t('reception.guardianEmail')}
              error={error('guardianEmail')}
              className="max-w-none"
            />
            <TextField
              name="guardianTaxNumber"
              inputMode="numeric"
              label={t('reception.guardianTaxNumber')}
              error={error('guardianTaxNumber')}
              className="max-w-none"
            />
          </div>
        </fieldset>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={BUTTON}>
          {t('reception.addPerson')}
        </button>
        <button type="button" onClick={onCancel} className={BUTTON_QUIET}>
          {t('reception.back')}
        </button>
      </div>
    </form>
  );
}

/** What a pass is good for now, in one sentence — the server's answers, rendered. */
function Standing({ pass }: { pass: Pass }): React.ReactElement {
  const t = useTranslations();

  if (pass.voided) return <span className="text-danger">{t('reception.standing.void')}</span>;
  if (pass.expired && pass.validUntil !== null) {
    return (
      <span className="text-danger">
        {t('reception.standing.expired', { date: formatDate(pass.validUntil) })}
      </span>
    );
  }
  if (pass.entriesLeft === 0) {
    return <span className="text-danger">{t('reception.standing.usedUp')}</span>;
  }
  if (pass.notYet) {
    return <span>{t('reception.standing.notYet', { date: formatDate(pass.validFrom) })}</span>;
  }

  const parts: string[] = [];
  if (pass.entriesLeft !== null && pass.entries !== null) {
    parts.push(t('reception.standing.left', { left: pass.entriesLeft, total: pass.entries }));
  }
  if (pass.validUntil !== null) {
    parts.push(t('reception.standing.until', { date: formatDate(pass.validUntil) }));
  }
  if (pass.inWater) parts.push(t('reception.standing.inWater'));
  return <span>{parts.join(' · ')}</span>;
}

function PersonPasses({
  facilityId,
  person,
  inWaterVersion,
  products,
  poolId,
  poolName,
  onClear,
}: {
  facilityId: string;
  person: Chosen;
  inWaterVersion: string;
  products: PassProduct[];
  poolId: string;
  poolName: string;
  onClear: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [passes, setPasses] = useState<Pass[] | null>(null);
  const [state, setState] = useState<'loading' | 'failed' | 'done'>('loading');

  const load = useCallback(async () => {
    setState((current) => (current === 'done' ? 'done' : 'loading'));
    const found = await passesOf(facilityId, person.membershipId);
    if (found === null) {
      setState('failed');
      return;
    }
    setPasses(found);
    setState('done');
  }, [facilityId, person.membershipId]);

  // Again whenever the in-water list changes: a check-out or a cancelled entry
  // at the bottom of the screen changes what this person's passes say.
  useEffect(() => {
    void load();
  }, [load, inWaterVersion]);

  // Expired, void and used-up passes stay listed — they answer "but I bought a
  // pack" — after the ones still good.
  const live = (passes ?? []).filter(
    (pass) => !pass.voided && !pass.expired && pass.entriesLeft !== 0,
  );
  const spent = (passes ?? []).filter((pass) => !live.includes(pass));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-lg font-medium">{person.name}</p>
        <button type="button" onClick={onClear} className={BUTTON_QUIET}>
          <X aria-hidden className="size-4" />
          {t('reception.otherPerson')}
        </button>
      </div>

      {state === 'loading' && (
        <p className="text-sm text-foreground-muted">{t('reception.loadingPasses')}</p>
      )}
      {state === 'failed' && (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger">
          {t('reception.passesFailed')}
          <button type="button" onClick={() => void load()} className={BUTTON_QUIET}>
            {t('reception.retry')}
          </button>
        </p>
      )}
      {state === 'done' && passes !== null && passes.length === 0 && (
        <p className="text-sm text-foreground-muted">{t('reception.noPasses')}</p>
      )}
      {state === 'done' && passes !== null && passes.length > 0 && (
        <ul className="divide-y divide-border">
          {[...live, ...spent].map((pass) => (
            <li
              key={pass.id}
              className={`flex flex-col gap-2 py-3 first:pt-0 last:pb-0 ${pass.shared ? '' : 'sm:flex-row sm:items-center sm:justify-between'}`}
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {pass.productName}
                  {/* POOLSE-204: a child's own pack, checked in from here. */}
                  {pass.holderStudentId !== null && pass.holderName !== null && (
                    <span className="font-normal text-foreground-muted">
                      {' '}
                      {t('reception.heldBy', { name: pass.holderName })}
                    </span>
                  )}
                </p>
                <p className="text-sm text-foreground-muted">
                  <Standing pass={pass} />
                  {pass.shared && ` · ${t('passes.shareableShort')}`}
                </p>
                {pass.soldVia === 'app' && !pass.paid && (
                  <p className="text-sm font-medium text-danger">{t('reception.unpaidAppPack')}</p>
                )}
              </div>
              {live.includes(pass) && poolId === '' && (
                <p className="shrink-0 text-sm text-foreground-muted">
                  {t('reception.chooseTankFirst')}
                </p>
              )}
              {live.includes(pass) && poolId !== '' && (
                <CheckInButton
                  facilityId={facilityId}
                  family={pass.shared ? pass.family : []}
                  passId={pass.id}
                  poolId={poolId}
                  poolName={poolName}
                  onDone={() => void load()}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      <SellForm
        facilityId={facilityId}
        membershipId={person.membershipId}
        products={products}
        poolId={poolId}
        onDone={() => void load()}
      />
    </div>
  );
}

function CheckInButton({
  facilityId,
  family,
  passId,
  poolId,
  poolName,
  onDone,
}: {
  facilityId: string;
  /** A family pack's people (POOLSE-204): the desk says who goes in. Empty for a personal pass. */
  family: Swimmer[];
  passId: string;
  poolId: string;
  poolName: string;
  onDone: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const keyOf = (one: Swimmer): string => (one.studentId !== null ? `s:${one.studentId}` : `m:${one.membershipId ?? ''}`);
  const [who, setWho] = useState(family[0] === undefined ? '' : keyOf(family[0]));
  const chosen = family.find((one) => keyOf(one) === who);
  const [, submit, pending] = useSavedAction(
    async (previous: ReceptionState, formData: FormData) => {
      const next = await checkInAction(previous, formData);
      if (next.ok) onDone();
      return next;
    },
    INITIAL,
  );
  return (
    <form action={submit} className="flex shrink-0 flex-wrap items-end gap-2">
      <input type="hidden" name="facilityId" value={facilityId} />
      <input type="hidden" name="passId" value={passId} />
      <input type="hidden" name="poolId" value={poolId} />
      {chosen?.membershipId != null && chosen.studentId === null && (
        <input type="hidden" name="membershipId" value={chosen.membershipId} />
      )}
      {chosen?.studentId != null && <input type="hidden" name="studentId" value={chosen.studentId} />}
      {family.length > 0 && (
        <SelectField
          name="swimmer"
          label={t('reception.whoSwims')}
          initial={who}
          onValueChange={setWho}
          options={family.map((one) => ({ value: keyOf(one), label: one.name }))}
          className="w-56 max-w-full"
        />
      )}
      <button type="submit" disabled={pending} className={BUTTON}>
        <LogIn aria-hidden className="size-4" />
        {t('reception.letIn', { pool: poolName })}
      </button>
    </form>
  );
}

function SellForm({
  facilityId,
  membershipId,
  products,
  poolId,
  onDone,
}: {
  facilityId: string;
  membershipId: string;
  products: PassProduct[];
  poolId: string;
  onDone: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [enter, setEnter] = useState(true);
  const [validFrom, setValidFrom] = useState('');
  const [atBase, setAtBase] = useState(false);
  const chosen = products.find((product) => product.id === productId);
  /*
   * POOLSE-203: the price this person pays and why, from `pass_price_for()` on
   * the server. Shown before the sale; the sale itself resolves it again, so
   * a stale screen can never charge a different figure than it says.
   */
  const [prices, setPrices] = useState<PersonPrice[] | 'failed' | null>(null);
  useEffect(() => {
    let live = true;
    void pricesOf(facilityId, membershipId).then((found) => {
      if (live) setPrices(found ?? 'failed');
    });
    return () => {
      live = false;
    };
  }, [facilityId, membershipId]);
  const priceOf = (id: string): PersonPrice | undefined =>
    Array.isArray(prices) ? prices.find((one) => one.productId === id) : undefined;
  const resolved = priceOf(productId);
  const discounted = resolved !== undefined && resolved.amountCents !== resolved.baseCents;
  /*
   * A pass that starts on a later day cannot let anybody in today — the trigger
   * refuses it and, being one transaction, the sale with it. So the box is not
   * offered then. The browser's date only decides whether to *offer* it; the
   * server still decides what is valid.
   */
  const today = todayOfClub();
  const startsLater = chosen?.kind !== 'single' && validFrom !== '' && validFrom > today;
  const [state, submit, pending] = useSavedAction(
    async (previous: ReceptionState, formData: FormData) => {
      const next = await sellAction(previous, formData);
      if (next.ok) onDone();
      return next;
    },
    INITIAL,
  );
  const fields = state.fields ?? {};

  return (
    <form action={submit} className="flex flex-col gap-3 rounded border border-border p-3">
      <input type="hidden" name="facilityId" value={facilityId} />
      <input type="hidden" name="membershipId" value={membershipId} />
      <input type="hidden" name="poolId" value={poolId} />
      <p className="text-sm font-medium">{t('reception.sellTitle')}</p>
      <SelectField
        name="productId"
        label={t('reception.product')}
        initial={productId}
        onValueChange={setProductId}
        options={products.map((product) => ({
          value: product.id,
          label: `${product.name} — ${formatCents(locale, priceOf(product.id)?.amountCents ?? product.amountCents)}`,
        }))}
        error={fields['productId'] === undefined ? undefined : t(fields['productId'])}
      />
      {/* The price and why, in words (POOLSE-203, rule 4). */}
      {prices === 'failed' && <p className="text-sm text-foreground-muted">{t('reception.priceUnknown')}</p>}
      {resolved !== undefined && (
        <p className="text-sm">
          {resolved.categoryNames === null || atBase
            ? t('reception.priceBase', { amount: formatCents(locale, resolved.baseCents) })
            : t('reception.priceFor', {
                amount: formatCents(locale, resolved.amountCents),
                categories: resolved.categoryNames,
              })}
        </p>
      )}
      {discounted && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="basePrice"
            checked={atBase}
            onChange={(event) => setAtBase(event.target.checked)}
            className="size-4"
          />
          {t('reception.sellAtBase', { amount: formatCents(locale, resolved.baseCents) })}
        </label>
      )}
      {/* A single entry is good today and no other day, so it asks no date. */}
      {chosen !== undefined && chosen.kind !== 'single' && (
        <TextField
          name="validFrom"
          type="date"
          label={t('reception.validFrom')}
          hint={t('reception.validFromHint')}
          initial={validFrom}
          onValueChange={setValidFrom}
          error={fields['validFrom'] === undefined ? undefined : t(fields['validFrom'])}
        />
      )}
      {startsLater ? (
        <p className="text-sm text-foreground-muted">{t('reception.startsLaterNoEntry')}</p>
      ) : poolId === '' ? (
        <p className="text-sm text-foreground-muted">{t('reception.chooseTankToEnter')}</p>
      ) : (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="checkIn"
            checked={enter}
            onChange={(event) => setEnter(event.target.checked)}
            className="size-4"
          />
          {t('reception.enterNow')}
        </label>
      )}
      <div>
        <button type="submit" disabled={pending} className={BUTTON}>
          {t('reception.sell')}
        </button>
      </div>
    </form>
  );
}
