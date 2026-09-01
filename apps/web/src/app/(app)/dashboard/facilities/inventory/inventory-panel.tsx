'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SearchInput, SearchStatus } from '@/components/search-input';
import { useTranslations } from 'next-intl';
import { ChevronRight, FileSpreadsheet, Trash2, Upload, X } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import type { InventoryItem, InventoryScope } from '@/lib/api';
import { CONTROL_LINE, FIELD_COLUMN, FIELD_LABEL } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import type { FormState } from '../../actions';
import { addItemAction, archiveItemAction, updateItemAction } from './inventory.actions';
import { InventoryImportWizard } from './import-wizard';

/**
 * What the club owns, at one site — round 6.
 *
 * This was a block on the pool page and it has moved, because the model moved:
 * an item belongs to a facility and says which tanks it serves. Almost nothing a
 * club owns belongs to one pool — the pranchas live in a store room and are
 * carried to whichever tank needs them, the desfibrilhador belongs to the
 * building — and asking "which single pool are these floats in" was a question
 * with no true answer, so operators picked one and wrote the truth in the notes.
 *
 * **The name is still free text.** The obvious alternative is a dropdown of
 * approved equipment types and it fails on the first club that keeps arcos.
 *
 * **A count, not a stock ledger.** One row per kind of thing, edited in place
 * after a stock check. Movements, reservations and minimum levels were all
 * considered and left out: a ledger nobody posts to drifts from the shelf within
 * a month, and then it is wrong with more decimal places than the count was.
 *
 * **It is the drop target for the whole screen.** Dragging the club's
 * spreadsheet onto the list is the gesture people already try, and the honest
 * answer is to do the thing rather than let the browser navigate away and render
 * the file as a download.
 */

const ACCEPTED = ['.xlsx', '.csv'];

const BUTTON =
  'rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const BUTTON_QUIET =
  'rounded border border-border px-4 py-2 text-sm hover:bg-surface-muted ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const INITIAL: FormState = { ok: false };

/** Whether the browser is dragging files rather than selected text or a link. */
function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

function isAccepted(file: File): boolean {
  const name = file.name.toLowerCase();
  return ACCEPTED.some((extension) => name.endsWith(extension));
}

interface Pool {
  id: string;
  name: string;
}

export function InventoryPanel({
  organizationId,
  facilities,
  facilityId,
  items,
  total,
  search,
  canManage,
}: {
  organizationId: string;
  facilities: { id: string; name: string; pools: Pool[] }[];
  facilityId: string;
  /** One page of the store, already filtered by the search. */
  items: InventoryItem[];
  /** How many matched the search — what the export and the empty state read. */
  total: number;
  search: string;
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const router = useRouter();

  const facility = facilities.find((site) => site.id === facilityId) ?? facilities[0];
  const pools = facility?.pools ?? [];

  /** The add-item card, folded away until somebody comes to write rather than read. */
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(false);
  const [formats, setFormats] = useState(false);
  const [dragging, setDragging] = useState(false);
  /** The dropped file waiting for a yes or a no. */
  const [pending, setPending] = useState<File | null>(null);
  /** The file the wizard is working on. Set only once the operator has agreed. */
  const [accepted, setAccepted] = useState<File | null>(null);

  const panel = useRef<HTMLDivElement | null>(null);
  const confirmButton = useRef<HTMLButtonElement | null>(null);
  const exportMenu = useRef<HTMLDivElement | null>(null);

  /*
   * Listeners on the window, not on a bordered rectangle.
   *
   * The target is "the inventory screen", so the whole screen has to accept the
   * drop. A zone somewhere down the page is a zone people miss, and missing it
   * means the browser navigates away to render the spreadsheet.
   *
   * `dragenter`/`dragover` must both cancel, or the browser keeps its own
   * default and the drop never reaches this code at all.
   */
  useEffect(() => {
    if (!canManage) return;
    let depth = 0;

    const onEnter = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setDragging(true);
    };

    const onOver = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
    };

    // Counted rather than toggled: dragging across a child element fires leave
    // on the parent, and a naive toggle makes the overlay flicker the whole way
    // across the page.
    const onLeave = (): void => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };

    const onDrop = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);

      const file = event.dataTransfer?.files?.[0] ?? null;
      if (file !== null) setPending(file);
    };

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);

    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [canManage]);

  /*
   * The format menu closes on Escape and on a click anywhere else — the two
   * things everybody tries. Without them it is a menu that traps you.
   */
  useEffect(() => {
    if (!formats) return;

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setFormats(false);
    };
    const onClick = (event: MouseEvent): void => {
      if (!exportMenu.current?.contains(event.target as Node)) setFormats(false);
    };

    window.addEventListener('keydown', onKey);
    // Capture, so a click on a control that stops propagation still closes this.
    window.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick, true);
    };
  }, [formats]);

  const dismiss = useCallback(() => setPending(null), []);

  // Escape closes the question, which is what every other dialog on the web does
  // and what somebody who dropped the wrong file reaches for first.
  useEffect(() => {
    if (pending === null) return;

    confirmButton.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, dismiss]);

  const reveal = (): void => {
    requestAnimationFrame(() =>
      panel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  };

  const accept = (): void => {
    if (pending === null || !isAccepted(pending)) return;
    setAccepted(pending);
    setPending(null);
    setOpen(true);
    reveal();
  };

  const close = (): void => {
    setAccepted(null);
    setOpen(false);
  };

  const usable = pending !== null && isAccepted(pending);

  /*
   * The export carries the search but never the page.
   *
   * An export is the whole filtered set, not the ten rows being looked at.
   * Handing `?page=3` to the exporter would produce a file whose contents depend
   * on where somebody happened to be scrolled — the same argument the register's
   * export makes, and the same reason it drops the page too.
   */
  const exportQuery = new URLSearchParams({ facilityId });
  if (search !== '') exportQuery.set('search', search);
  const exportHref = `/dashboard/facilities/inventory/export?${exportQuery}`;

  return (
    <>
      {/*
        The site picker is a real navigation rather than client state: a site's
        inventory is a place, so it gets an address somebody can bookmark and
        send. Only when there is more than one site to choose between.
      */}
      {facilities.length > 1 && (
        <div className={cn(FIELD_COLUMN, 'max-w-form')}>
          <label htmlFor="inventory-facility" className={FIELD_LABEL}>
            {t('inventory.siteLabel')}
          </label>
          <select
            id="inventory-facility"
            value={facilityId}
            onChange={(event) =>
              router.push(`/dashboard/facilities/inventory?facilityId=${event.target.value}`)
            }
            className={CONTROL_LINE}
          >
            {facilities.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/*
        Adding an item, at the top and folded away.

        It was underneath the list, which is where a form belongs when the list
        is six rows — and wrong once the list pages, because the control you came
        to use is then below ten rows you did not. Folded rather than simply
        moved: this screen is read far more often than it is written to, and an
        open four-field form above the search box would push the list off the
        first screen for everybody who came to look something up.
      */}
      {canManage && (
        <section className="rounded border border-border bg-surface">
          <h2>
            <button
              type="button"
              onClick={() => setAdding((shown) => !shown)}
              aria-expanded={adding}
              aria-controls="inventory-add"
              className="flex w-full items-center gap-2 p-5 text-left text-sm font-medium uppercase tracking-wider text-foreground-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {/*
                The chevron turns, and it is not the only cue — the button
                carries `aria-expanded`, so the state is available to somebody
                who cannot see it rotate.
              */}
              <ChevronRight
                aria-hidden
                className={cn('size-4 transition-transform', adding && 'rotate-90')}
              />
              {t('inventory.add')}
            </button>
          </h2>

          {adding && (
            <div id="inventory-add" className="border-t border-border p-5">
              <AddItemForm
                organizationId={organizationId}
                facilityId={facilityId}
                pools={pools}
              />
            </div>
          )}
        </section>
      )}

      {/*
        Finding something, and the two ways a whole list moves in or out.

        One card, because they are the same job — "act on the list as it is" —
        and because keeping the importer's button beside the search box puts it
        below the add form, which is the order somebody actually works in: add
        one thing, or bring in forty.

        No submit button. The box commits itself into the URL after a short
        debounce, or at once on Enter, and a new term drops the page so a search
        always starts at the first one.
      */}
      <section className="flex flex-wrap items-end gap-3 rounded border border-border bg-surface p-5">
        <SearchInput
          label={t('inventory.search')}
          placeholder={t('inventory.searchPlaceholder')}
        />

        {canManage && (
          <button
            type="button"
            onClick={() => {
              // Already open and showing a dropped file: clicking again should
              // give a clean sheet rather than leave the old one on screen.
              setAccepted(null);
              setOpen(true);
              reveal();
            }}
            aria-expanded={open}
            className={BUTTON_QUIET}
          >
            {t('inventory.import.action')}
          </button>
        )}

        {/*
          The format is asked for only once exporting has been asked for. A
          permanently visible picker made somebody answer a question they had not
          asked yet — most exports are the workbook.

          Plain anchors, not `Link`: the answer is a file, so there is no client
          navigation to make and `Link` would prefetch a spreadsheet.
        */}
        {total > 0 && (
          <div ref={exportMenu} className="relative">
            <button
              type="button"
              onClick={() => setFormats((shown) => !shown)}
              aria-expanded={formats}
              aria-haspopup="menu"
              className={BUTTON_QUIET}
            >
              {search === ''
                ? t('inventory.export.action')
                : t('inventory.export.actionFiltered')}
            </button>

            {formats && (
              <div
                role="menu"
                aria-label={t('students.export.formatLabel')}
                className="absolute left-0 top-full z-20 mt-1 flex min-w-full flex-col rounded border border-border bg-surface py-1 shadow-lg"
              >
                {(['xlsx', 'csv'] as const).map((choice) => (
                  <a
                    key={choice}
                    role="menuitem"
                    href={`${exportHref}&format=${choice}`}
                    onClick={() => setFormats(false)}
                    className="whitespace-nowrap px-4 py-2 text-left text-sm hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    {choice === 'xlsx'
                      ? t('students.export.formatXlsx')
                      : t('students.export.formatCsv')}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        <SearchStatus total={total} term={search} />
      </section>

      {dragging && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-background/80 p-6"
        >
          <div className="flex flex-col items-center gap-3 rounded border-2 border-dashed border-primary bg-surface px-10 py-8 text-center">
            <FileSpreadsheet className="size-8 text-primary" />
            <p className="text-lg font-medium">{t('inventory.import.dropTitle')}</p>
            <p className="text-sm text-foreground-muted">{t('inventory.import.dropHint')}</p>
          </div>
        </div>
      )}

      {/*
        A drop asks before it does anything. Files are dragged by accident — over
        a window on the way somewhere else, or the wrong one out of a folder of
        twenty — and a screen that begins reading a file nobody meant to give it
        is a screen people stop dragging onto.
      */}
      {pending !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="inventory-drop-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4"
        >
          <div className="flex w-full max-w-md flex-col gap-4 rounded border border-border bg-surface p-5 shadow-lg">
            <h2 id="inventory-drop-title" className="text-base font-medium">
              {usable ? t('inventory.import.confirmTitle') : t('students.import.confirmRefused')}
            </h2>

            <p className="flex items-start gap-2 text-sm">
              <FileSpreadsheet
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-foreground-muted"
              />
              <span className="break-all font-medium">{pending.name}</span>
            </p>

            <p className="text-sm text-foreground-muted">
              {usable
                ? t('inventory.import.confirmHint', { site: facility?.name ?? '' })
                : t('students.import.errorFileType')}
            </p>

            <div className="flex flex-wrap justify-end gap-3">
              {usable && (
                <button ref={confirmButton} type="button" onClick={accept} className={BUTTON}>
                  <span className="flex items-center gap-2">
                    <Upload aria-hidden className="size-4" />
                    {t('students.import.confirmAccept')}
                  </span>
                </button>
              )}
              <button
                ref={usable ? null : confirmButton}
                type="button"
                onClick={dismiss}
                className={BUTTON_QUIET}
              >
                {usable ? t('students.import.confirmCancel') : t('students.import.confirmClose')}
              </button>
            </div>
          </div>
        </div>
      )}

      {open && (
        <section ref={panel} className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('inventory.import.title')}
              </h2>
              <p className="mt-1 text-sm text-foreground-muted">{t('inventory.import.subtitle')}</p>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label={t('students.import.close')}
              className="rounded border border-border p-1.5 hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>

          {/*
            Keyed on the file so a second drop starts a clean wizard rather than
            trying to reconcile a new spreadsheet with the previous one's
            mapping, which would point column indexes at a grid that no longer
            has them.
          */}
          <InventoryImportWizard
            key={accepted === null ? 'chosen' : `${accepted.name}:${accepted.lastModified}`}
            facilityId={facilityId}
            facilityName={facility?.name ?? ''}
            poolNames={pools.map((pool) => pool.name)}
            initialFile={accepted}
            onClose={close}
          />
        </section>
      )}

      <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
        <p className="text-sm text-foreground-muted">{t('inventory.hint')}</p>

        {/*
          Two different nothings, said differently. "Ainda não há artigos" on a
          search that matched nothing would tell an operator their store room is
          empty when it holds four hundred things — and the fix for one is to add
          an item while the fix for the other is to clear the box.
        */}
        {items.length === 0 ? (
          <p className="text-sm text-foreground-muted">
            {search === '' ? t('inventory.empty') : t('inventory.noMatches', { term: search })}
          </p>
        ) : (
          /*
            A table, since the counts needed a heading.

            It was a list with the number floating at the right-hand end, which
            reads as a count of *something* and never says what. A column with
            "Quantidade" over it says it once, for every row — and the unit sits
            beside the number rather than above it, because "30 pares" is one
            fact and splitting it across two columns would leave most rows with
            an empty one.

            The table scrolls inside its own container; the page never scrolls
            sideways.
          */
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-foreground-muted">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('inventory.field.name')}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('inventory.scopeLabel')}
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">
                    {t('inventory.field.quantity')}
                  </th>
                  {canManage && (
                    <th scope="col" className="w-24 py-2">
                      <span className="sr-only">{t('inventory.actions')}</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <ItemRow
                    key={item.id}
                    organizationId={organizationId}
                    item={item}
                    pools={pools}
                    canManage={canManage}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

      </section>
    </>
  );
}

function Failure({ state }: { state: FormState }): React.ReactElement | null {
  const t = useTranslations();
  if (state.errorKey === undefined) return null;

  return (
    <p className="w-full text-sm text-danger">
      {t(state.errorKey)}
      {state.detail !== undefined && (
        <span className="ml-2 font-mono text-xs text-foreground-muted">{state.detail}</span>
      )}
    </p>
  );
}

/** Where an item lives, in words. Visible text, never a colour or an icon alone. */
function ScopeText({ item }: { item: InventoryItem }): React.ReactElement {
  const t = useTranslations();

  if (item.scope === 'facility') {
    return <span className="text-sm text-foreground-muted">{t('inventory.scope.facility')}</span>;
  }
  if (item.scope === 'all_pools') {
    return <span className="text-sm text-foreground-muted">{t('inventory.scope.all_pools')}</span>;
  }
  return (
    <span className="text-sm text-foreground-muted">
      {item.poolNames.length === 0 ? t('inventory.scope.noPools') : item.poolNames.join(' · ')}
    </span>
  );
}

/**
 * One item, editable where it sits.
 *
 * Read-only until somebody asks to change it, because this list is read far more
 * often than it is corrected and a screen of live inputs reads as a form to fill
 * in rather than as a list of what is in the cupboard.
 */
function ItemRow({
  organizationId,
  item,
  pools,
  canManage,
}: {
  organizationId: string;
  item: InventoryItem;
  pools: Pool[];
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useSavedAction(updateItemAction, INITIAL);
  const [archiveState, archive, archiving] = useSavedAction(archiveItemAction, INITIAL);

  /*
   * Editing takes the whole width, because the form is four fields and a set of
   * pool checkboxes and would be unreadable squeezed into three columns. One
   * `colSpan` row rather than a modal: correcting a count is the operation this
   * screen exists for, and it should not cost a dialog.
   */
  if (editing) {
    return (
      <tr className="border-b border-border last:border-0">
        <td colSpan={canManage ? 4 : 3} className="py-3">
          <form action={action} onSubmit={() => setEditing(false)} className="flex flex-col gap-3">
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="itemId" value={item.id} />

            <Fields item={item} pools={pools} />

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={pending}
                className="h-control rounded bg-primary px-4 text-sm text-primary-foreground disabled:opacity-60"
              >
                {pending ? t('common.working') : t('common.save')}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="h-control rounded border border-border px-4 text-sm"
              >
                {t('common.cancel')}
              </button>
            </div>

            <Failure state={state} />
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-border align-top last:border-0">
      <td className="py-3 pr-4">
        <span className="font-medium">{item.name}</span>
        {item.notes !== null && item.notes !== '' && (
          <span className="block text-foreground-muted">{item.notes}</span>
        )}
        <Failure state={archiveState} />
      </td>

      <td className="py-3 pr-4">
        <ScopeText item={item} />
      </td>

      {/*
        Right-aligned under its heading, with the unit beside the number rather
        than in a column of its own: "30 pares" is one fact, and splitting it
        would leave most rows with an empty cell.

        `tabular-nums` so a column of counts lines up rather than dancing by a
        pixel per digit.
      */}
      <td className="py-3 pr-4 text-right tabular-nums">
        {item.quantity}
        {item.unit !== null && item.unit !== '' && (
          <span className="ml-1 text-foreground-muted">{item.unit}</span>
        )}
      </td>

      {canManage && (
        <td className="py-3">
          <div className="flex items-center justify-end gap-4">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {t('inventory.edit')}
            </button>

            <form action={archive}>
              <input type="hidden" name="organizationId" value={organizationId} />
              <input type="hidden" name="itemId" value={item.id} />
              <button
                type="submit"
                disabled={archiving}
                aria-label={t('inventory.removeLabel', { name: item.name })}
                className="rounded text-foreground-muted hover:text-danger disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <Trash2 className="size-4" />
              </button>
            </form>
          </div>
        </td>
      )}
    </tr>
  );
}

/**
 * Add one kind of item.
 *
 * The text inputs are uncontrolled on purpose, and the exception proves the rule
 * in `field.tsx`: that rule exists because a form React resets on a returned
 * error wipes what somebody was correcting. Here the reset is what is wanted —
 * the form's whole job is to be typed into repeatedly, and after "Flutuadores,
 * 24" is added the next thing anybody does is type a different item. On an error
 * the fields do hold, because a failed action returns state and React only
 * resets on success.
 *
 * The scope is different: it is React state, because the pool checkboxes only
 * exist while it says "these tanks", and a `<select>` the browser owns cannot
 * drive that.
 */
function AddItemForm({
  organizationId,
  facilityId,
  pools,
}: {
  organizationId: string;
  facilityId: string;
  pools: Pool[];
}): React.ReactElement {
  const t = useTranslations();
  const [state, action, pending] = useSavedAction(addItemAction, INITIAL);

  return (
    <form action={action} className="flex flex-col gap-3 border-t border-border pt-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="facilityId" value={facilityId} />

      <Fields pools={pools} />

      <button
        type="submit"
        disabled={pending}
        className="h-control self-start rounded bg-primary px-4 text-sm text-primary-foreground disabled:opacity-60"
      >
        {pending ? t('common.working') : t('inventory.add')}
      </button>

      <Failure state={state} />
    </form>
  );
}

/** The same fields, whether adding or correcting. */
function Fields({ item, pools }: { item?: InventoryItem; pools: Pool[] }): React.ReactElement {
  const t = useTranslations();
  const suffix = item?.id ?? 'new';
  const [scope, setScope] = useState<InventoryScope>(item?.scope ?? 'facility');

  return (
    <>
      {/*
        Fixed widths only once there is room for them. Below `sm` each field
        takes the row — four side-by-side boxes on a 320px screen is four boxes
        too narrow to type a word into, and `flex-wrap` alone would still let the
        widest of them push the page sideways.
      */}
      <div className="flex flex-wrap items-end gap-3">
        <div className={cn(FIELD_COLUMN, 'sm:w-56')}>
          <label htmlFor={`item-name-${suffix}`} className={FIELD_LABEL}>
            {t('inventory.field.name')}
          </label>
          <input
            id={`item-name-${suffix}`}
            name="name"
            required
            maxLength={120}
            defaultValue={item?.name ?? ''}
            placeholder={t('inventory.namePlaceholder')}
            className={CONTROL_LINE}
          />
        </div>

        <div className={cn(FIELD_COLUMN, 'sm:w-24')}>
          <label htmlFor={`item-quantity-${suffix}`} className={FIELD_LABEL}>
            {t('inventory.field.quantity')}
          </label>
          <input
            id={`item-quantity-${suffix}`}
            name="quantity"
            type="number"
            min={0}
            step={1}
            defaultValue={item?.quantity ?? 0}
            className={CONTROL_LINE}
          />
        </div>

        <div className={cn(FIELD_COLUMN, 'sm:w-28')}>
          <label htmlFor={`item-unit-${suffix}`} className={FIELD_LABEL}>
            {t('inventory.field.unit')}
          </label>
          <input
            id={`item-unit-${suffix}`}
            name="unit"
            maxLength={40}
            defaultValue={item?.unit ?? ''}
            placeholder={t('inventory.unitPlaceholder')}
            className={CONTROL_LINE}
          />
        </div>

        <div className={cn(FIELD_COLUMN, 'sm:w-64')}>
          <label htmlFor={`item-notes-${suffix}`} className={FIELD_LABEL}>
            {t('inventory.field.notes')}
          </label>
          <input
            id={`item-notes-${suffix}`}
            name="notes"
            maxLength={500}
            defaultValue={item?.notes ?? ''}
            className={CONTROL_LINE}
          />
        </div>
      </div>

      {/*
        Where it lives, asked once and answered in three ways.

        A site with no tanks at all is offered nothing to choose: "the building"
        is then the only true answer, and a picker with one option is a question
        that wastes somebody's attention. The hidden field still posts it, so the
        form's shape does not change.
      */}
      {pools.length === 0 ? (
        <input type="hidden" name="scope" value="facility" />
      ) : (
        <div className="flex flex-col gap-2">
          <div className={cn(FIELD_COLUMN, 'sm:w-64')}>
            <label htmlFor={`item-scope-${suffix}`} className={FIELD_LABEL}>
              {t('inventory.scopeLabel')}
            </label>
            <select
              id={`item-scope-${suffix}`}
              name="scope"
              value={scope}
              onChange={(event) => setScope(event.target.value as InventoryScope)}
              className={CONTROL_LINE}
            >
              <option value="facility">{t('inventory.scope.facility')}</option>
              <option value="all_pools">{t('inventory.scope.all_pools')}</option>
              <option value="pools">{t('inventory.scope.pools')}</option>
            </select>
          </div>

          {scope === 'pools' && (
            <fieldset className="flex flex-col gap-2 rounded border border-border p-3">
              <legend className={cn(FIELD_LABEL, 'px-1')}>{t('inventory.choosePools')}</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {pools.map((pool) => (
                  <label key={pool.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="poolIds"
                      value={pool.id}
                      defaultChecked={item?.poolIds.includes(pool.id) ?? false}
                      className="size-4 accent-[rgb(var(--primary))]"
                    />
                    {pool.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      )}
    </>
  );
}
