'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search, UserPlus, X } from 'lucide-react';
import type { DuplicateMatch, Guardian, PersonSummary } from '@/lib/api';
import { ageInYears } from '@/lib/ages';
import { TextField } from '@/components/ui/field';
import { RoleBadges } from '@/components/role-badge';
import { findDuplicateAction, searchPeopleAction } from './students.actions';

/**
 * The encarregado de educação — POOLSE-04, rewritten on POOLSE-17.
 *
 * **A guardian is a person, not six text fields.** That is the whole change. The
 * grandmother who brings three grandchildren was three copies of one woman, so
 * correcting her phone number meant finding all three; now she is one record and
 * three links. Enrolling a second child searches for her rather than asking
 * somebody to type her again.
 *
 * **It appears and disappears live, and nothing typed is lost.** The block stays
 * mounted whatever the date of birth says; only its visibility changes. An
 * operator who mistypes 2010 as 1910, fills the block in, and then corrects the
 * year would otherwise watch their work empty itself — React throws state away
 * when it unmounts, silently.
 *
 * **Nothing is severed when a student turns eighteen** (criterion 8). The block
 * collapses to something they can reopen and the links still post, because "who
 * was your guardian" remains true about the years it covered.
 *
 * **A missing date of birth shows nothing.** Most students have none after an
 * import, and demanding a guardian for somebody whose age nobody knows would
 * fail most rows.
 *
 * **Clerk's people are read-only here** (criterion 3). Somebody with a login has
 * their name and email owned by Clerk; editing them in this form would appear to
 * work and be reverted by the next webhook. Their own page is where those change.
 */

/** What the form posts, and what the API reads back. */
interface Draft {
  membershipId: string | null;
  name: string;
  relationship: string;
  phone: string;
  email: string;
  taxNumber: string;
  address: string;
  isPrimary: boolean;
  /** True for an existing person — their details show, they do not edit here. */
  hasLogin: boolean;
  /** Existing people are shown as a card rather than as six inputs. */
  existing: boolean;
}

function draftOf(guardian: Guardian): Draft {
  return {
    membershipId: guardian.membershipId,
    name: guardian.name,
    relationship: guardian.relationship ?? '',
    phone: guardian.phone ?? '',
    email: guardian.email ?? '',
    taxNumber: guardian.taxNumber ?? '',
    address: guardian.address ?? '',
    isPrimary: guardian.isPrimary,
    hasLogin: guardian.hasLogin,
    existing: true,
  };
}

const BLANK: Draft = {
  membershipId: null,
  name: '',
  relationship: '',
  phone: '',
  email: '',
  taxNumber: '',
  address: '',
  isPrimary: true,
  hasLogin: false,
  existing: false,
};

export function GuardianBlock({
  guardians,
  birthDateInputId,
  ageOfMajority,
  errors,
}: {
  guardians: Guardian[] | undefined;
  /** The date field elsewhere in the same form, watched for changes. */
  birthDateInputId: string;
  /** The club's maioridade — POOLSE-22. Never a hardcoded 18. */
  ageOfMajority: number;
  errors: Record<string, string> | undefined;
}): React.ReactElement {
  const t = useTranslations();

  const [drafts, setDrafts] = useState<Draft[]>(() => (guardians ?? []).map(draftOf));
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
  const minor = age !== null && age < ageOfMajority;
  const hasData = drafts.length > 0;
  const open = minor || reopened || (age === null && hasData);

  // Nothing to say: no date of birth, and nobody recorded.
  if (age === null && !hasData) return <></>;

  const update = (index: number, change: Partial<Draft>): void =>
    setDrafts((current) =>
      current.map((draft, at) => (at === index ? { ...draft, ...change } : draft)),
    );

  const makePrimary = (index: number): void =>
    setDrafts((current) => current.map((draft, at) => ({ ...draft, isPrimary: at === index })));

  const remove = (index: number): void =>
    setDrafts((current) => {
      const next = current.filter((_, at) => at !== index);
      // Somebody has to be the one you ring. Removing the primary promotes the
      // next rather than leaving the question unanswered.
      if (next.length > 0 && !next.some((draft) => draft.isPrimary)) next[0]!.isPrimary = true;
      return next;
    });

  return (
    <section
      className="flex flex-col gap-4 rounded border border-border bg-surface-muted p-4"
      aria-labelledby="guardian-heading"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2
          id="guardian-heading"
          className="text-sm font-medium uppercase tracking-wider text-foreground-muted"
        >
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

      {/*
        The age comes from the setting, not from the sentence — POOLSE-22,
        criterion 5. "menor de idade" reads the same at 16 or 21, and the number
        appears where it is actually needed.
      */}
      <p className="text-sm text-foreground-muted">
        {minor
          ? t('students.guardianRequiredHint', { age: ageOfMajority })
          : t('students.guardianAdultHint', { age: ageOfMajority })}
      </p>

      {/*
        One hidden field carrying the whole list, rather than indexed input names.
        The set is what the API takes — links no longer listed are archived — and
        a name like `guardians[1].phone` is a shape that has to be reassembled on
        the other side, which is a parser nobody wants to own.

        Hidden rather than unmounted, so correcting a mistyped year brings the
        block back with everything still in it.
      */}
      <input type="hidden" name="guardians" value={JSON.stringify(drafts)} />

      <div className={open ? 'flex flex-col gap-4' : 'hidden'}>
        {drafts.map((draft, index) => (
          <GuardianRow
            key={draft.membershipId ?? `new-${index}`}
            draft={draft}
            index={index}
            only={drafts.length === 1}
            errors={index === 0 ? errors : undefined}
            onChange={(change) => update(index, change)}
            onPrimary={() => makePrimary(index)}
            onRemove={() => remove(index)}
          />
        ))}

        {drafts.length === 0 && <PersonPicker onPick={(draft) => setDrafts([draft])} />}

        {drafts.length > 0 && drafts.length < 4 && (
          <details className="rounded border border-dashed border-border p-3">
            <summary className="cursor-pointer text-sm text-primary">
              {t('students.guardianAddAnother')}
            </summary>
            <div className="mt-3">
              <PersonPicker
                onPick={(draft) =>
                  setDrafts((current) => [...current, { ...draft, isPrimary: false }])
                }
              />
            </div>
          </details>
        )}
      </div>
    </section>
  );
}

/**
 * One guardian: either a person already known, or somebody being typed in.
 *
 * An existing person shows as a card. Their details belong to them and are
 * edited on their own page — POOLSE-04, criterion 3 — so showing them as inputs
 * here would invite an edit that either fails or silently diverges from the
 * record the rest of the club sees. The relationship is the exception, and the
 * one field that genuinely belongs to this pairing.
 */
function GuardianRow({
  draft,
  index,
  only,
  errors,
  onChange,
  onPrimary,
  onRemove,
}: {
  draft: Draft;
  index: number;
  only: boolean;
  errors: Record<string, string> | undefined;
  onChange: (change: Partial<Draft>) => void;
  onPrimary: () => void;
  onRemove: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const error = (field: string): string | undefined =>
    errors?.[field] === undefined ? undefined : t(errors[field] as string);

  return (
    <div className="flex flex-col gap-3 rounded border border-border bg-surface p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">
          {draft.name === '' ? t('students.guardianNew') : draft.name}
        </span>

        <div className="flex items-center gap-3">
          {/*
            Not a checkbox each — that lets two be ticked, and "who do we ring
            first" has one answer. A radio across the group is the control that
            matches the constraint the database enforces.
          */}
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name="guardianPrimary"
              checked={draft.isPrimary}
              onChange={onPrimary}
              className="size-4 accent-primary"
            />
            {t('students.guardianPrimary')}
          </label>

          <button
            type="button"
            onClick={onRemove}
            aria-label={t('students.guardianRemove', { name: draft.name })}
            className="rounded p-1 text-foreground-muted hover:text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/*
          Always editable, whoever they are: it belongs to this pairing rather
          than to the person. The same woman is "avó" to one child and "tutora
          legal" to another.
        */}
        <TextField
          name={`guardianRelationship-${index}`}
          label={t('students.guardianRelationship')}
          initial={draft.relationship}
          placeholder={t('students.guardianRelationshipPlaceholder')}
          error={error('guardianRelationship')}
          maxLength={80}
          onValueChange={(value) => onChange({ relationship: value })}
        />

        {draft.existing ? (
          <ReadOnlyPerson draft={draft} />
        ) : (
          <>
            <TextField
              name={`guardianName-${index}`}
              label={t('students.guardianName')}
              initial={draft.name}
              error={error('guardianName')}
              autoComplete="name"
              maxLength={120}
              onValueChange={(value) => onChange({ name: value })}
            />
            <TextField
              name={`guardianPhone-${index}`}
              type="tel"
              label={t('students.guardianPhone')}
              initial={draft.phone}
              error={error('guardianPhone')}
              autoComplete="tel"
              maxLength={40}
              onValueChange={(value) => onChange({ phone: value })}
            />
            <TextField
              name={`guardianEmail-${index}`}
              type="email"
              label={t('students.guardianEmail')}
              initial={draft.email}
              error={error('guardianEmail')}
              autoComplete="email"
              maxLength={254}
              onValueChange={(value) => onChange({ email: value })}
            />
            <TextField
              name={`guardianTaxNumber-${index}`}
              label={t('students.guardianTaxNumber')}
              initial={draft.taxNumber}
              hint={t('students.guardianTaxNumberHint')}
              maxLength={20}
              onValueChange={(value) => onChange({ taxNumber: value })}
            />

            {/*
              POOLSE-17 AC9. The warning appears while the NIF or the email is
              being typed, which is the only moment it can prevent a duplicate
              rather than report one.
            */}
            <DuplicateWarning
              taxNumber={draft.taxNumber}
              email={draft.email}
              onUse={(match) =>
                onChange({
                  membershipId: match.membershipId,
                  name: match.name,
                  email: match.email ?? '',
                  phone: match.phone ?? '',
                  existing: true,
                })
              }
            />
            <TextField
              name={`guardianAddress-${index}`}
              label={t('students.guardianAddress')}
              initial={draft.address}
              hint={t('students.optionalHint')}
              maxLength={500}
              onValueChange={(value) => onChange({ address: value })}
            />
          </>
        )}
      </div>

      {only && draft.existing && (
        <p className="text-sm text-foreground-muted">{t('students.guardianEditElsewhere')}</p>
      )}
    </div>
  );
}

/** An existing person's details, shown rather than offered for editing. */
function ReadOnlyPerson({ draft }: { draft: Draft }): React.ReactElement {
  const t = useTranslations();

  const rows = [
    { label: t('students.guardianPhone'), value: draft.phone },
    { label: t('students.guardianEmail'), value: draft.email },
    { label: t('students.guardianTaxNumber'), value: draft.taxNumber },
    { label: t('students.guardianAddress'), value: draft.address },
  ].filter((row) => row.value !== '');

  if (rows.length === 0) {
    return <p className="self-center text-sm text-foreground-muted">{t('students.guardianNoDetails')}</p>;
  }

  return (
    <dl className="flex flex-col gap-1 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="flex gap-2">
          <dt className="shrink-0 text-foreground-muted">{row.label}</dt>
          <dd className="break-words">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Find somebody the club already knows, or start a new one — POOLSE-17,
 * criteria 2 and 9.
 *
 * Search first, deliberately. The whole failure this ticket names is a second
 * copy of a person who was already there, and a form that opened on empty fields
 * would invite exactly that. "Adicionar novo" is one click away for the case
 * where they really are new.
 */
function PersonPicker({ onPick }: { onPick: (draft: Draft) => void }): React.ReactElement {
  const t = useTranslations();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PersonSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }

    // Debounced, and the stale-response guard matters more than the delay: typing
    // "Ana" fires three searches and the shortest can answer last, which without
    // this would leave the list showing matches for "A".
    const attempt = ++latest.current;
    setSearching(true);

    const timer = setTimeout(() => {
      void searchPeopleAction(term).then((people) => {
        if (attempt !== latest.current) return;
        setResults(people);
        setSearching(false);
      });
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-foreground-muted">{t('students.guardianFind')}</span>
        <span className="flex items-center gap-2 rounded border border-border bg-background px-3 py-2 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary">
          <Search className="size-4 shrink-0 text-foreground-muted" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('students.guardianFindPlaceholder')}
            className="w-full bg-transparent outline-none"
          />
        </span>
      </label>

      {searching && <p className="text-sm text-foreground-muted">{t('common.working')}</p>}

      {results.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded border border-border bg-surface">
          {results.map((person) => (
            <li key={person.membershipId}>
              <button
                type="button"
                onClick={() =>
                  onPick({
                    membershipId: person.membershipId,
                    name: person.name,
                    relationship: '',
                    phone: person.phone ?? '',
                    email: person.email ?? '',
                    taxNumber: person.taxNumber ?? '',
                    address: person.address ?? '',
                    isPrimary: true,
                    hasLogin: person.hasLogin,
                    existing: true,
                  })
                }
                className="flex w-full flex-col gap-1 p-3 text-left hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
              >
                <span className="flex flex-wrap items-center gap-2">
                  {/*
                    The full name here, deliberately, against the list rule —
                    POOLSE-32 AC2 names lists, cards, rosters and the calendar,
                    and this is none of them. It is an identity confirmation:
                    the whole job of this row is telling two people apart before
                    somebody links a child to the wrong one, and abbreviating
                    "Maria Ferreira Silva" and "Maria Costa Silva" to the same
                    two words would remove exactly the evidence needed.
                  */}
                  <span className="font-medium">{person.name}</span>
                  <RoleBadges roles={person.roles} />
                </span>
                <span className="text-sm text-foreground-muted">
                  {[person.email, person.phone].filter(Boolean).join(' · ')}
                </span>
                {/*
                  "Já encarregado de 2 alunos" is what makes a pick confident —
                  it is how somebody recognises the right Maria Silva of two.
                */}
                {person.guardianOf > 0 && (
                  <span className="text-sm text-foreground-muted">
                    {t('students.guardianAlreadyOf', { count: person.guardianOf })}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {query.trim().length >= 2 && !searching && results.length === 0 && (
        <p className="text-sm text-foreground-muted">{t('students.guardianNoMatches')}</p>
      )}

      <button
        type="button"
        onClick={() => onPick({ ...BLANK, name: query.trim() })}
        className="inline-flex items-center gap-2 self-start rounded border border-border px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <UserPlus className="size-4" aria-hidden />
        {t('students.guardianAddNew')}
      </button>
    </div>
  );
}

/**
 * "This person is already here" — POOLSE-17 AC9.
 *
 * Checked as the stable key is typed, because a duplicate warning that arrives
 * on submit arrives after the operator has filled in six fields and is not in
 * the mood to be told they were unnecessary.
 *
 * Offers the existing person rather than merely refusing. AC9's wording is
 * "warns and offers to add the role to the existing Person", and taking the
 * offer here means selecting them — the guardian link then grants the role, so
 * one path does both.
 *
 * Debounced, with a stale-response guard: typing a nine-digit NIF fires several
 * checks and the shortest can answer last, which without this would leave the
 * warning showing a match for a prefix.
 */
function DuplicateWarning({
  taxNumber,
  email,
  onUse,
}: {
  taxNumber: string;
  email: string;
  onUse: (match: DuplicateMatch) => void;
}): React.ReactElement {
  const t = useTranslations();
  const [match, setMatch] = useState<DuplicateMatch | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    const nif = taxNumber.trim();
    const address = email.trim();

    // A NIF is nine digits in Portugal; anything shorter is somebody mid-type,
    // and an email without an @ is not yet an address.
    const worthChecking = nif.length >= 9 || address.includes('@');
    if (!worthChecking) {
      setMatch(null);
      return;
    }

    const attempt = ++latest.current;
    const timer = setTimeout(() => {
      void findDuplicateAction(nif, address).then((found) => {
        if (attempt === latest.current) setMatch(found);
      });
    }, 300);

    return () => clearTimeout(timer);
  }, [taxNumber, email]);

  if (match === null) return <></>;

  return (
    <div className="sm:col-span-2 flex flex-col gap-2 rounded border border-warning/40 bg-warning/10 p-3">
      <p className="text-sm">
        {t(match.matchedOn === 'nif' ? 'students.duplicateByNif' : 'students.duplicateByEmail', {
          name: match.name,
        })}
      </p>

      <p className="flex flex-wrap items-center gap-2 text-sm text-foreground-muted">
        <RoleBadges roles={match.roles} />
        {match.guardianOf > 0 && t('students.guardianAlreadyOf', { count: match.guardianOf })}
      </p>

      <button
        type="button"
        onClick={() => onUse(match)}
        className="self-start rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground"
      >
        {t('students.duplicateUseExisting')}
      </button>
    </div>
  );
}
