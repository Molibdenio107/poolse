'use client';

import { startTransition, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Check, FileSearch, PenLine, Plus, Trash2, Upload } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import { cn } from '@/lib/utils';
import { CONTROL_LINE, FIELD_LABEL } from '@/components/ui/field';
import { DropOverlay, useFileDrop } from '@/components/file-drop';
import { REPORT_MEDIA_TYPES } from '@/lib/analysis-report';
import {
  LINE_KINDS,
  REGISTERS,
  TARIFF_PERIODS,
  emptyInvoiceDraft,
  emptyLine,
  emptyRegister,
  type InvoiceDraft,
  type LineDraft,
  type LineKind,
  type RegisterDraft,
  type RegisterName,
} from '@/lib/energy-invoice';
import {
  commitInvoiceAction,
  previewInvoiceAction,
  readInvoiceFileAction,
  type InvoicePreviewState,
  type InvoiceReadState,
} from '../../invoice.actions';

/**
 * The bill, as a form — slice 5.3.
 *
 * **One form for both ways in.** Empty, it is *Registar fatura*; filled by the
 * parser, it is the import's preview, every field editable. Whichever way the
 * draft arrived, the same *Verificar* sends it to the API's preview and the
 * same *Registar* commits it, so a bill the operator was shown is the bill that
 * gets written.
 *
 * **The draft is state, and the form posts it as one JSON field.** A bill has
 * registers and lines, and a flat `FormData` of `lines.3.unitPrice` would be a
 * second serialisation to keep in step with the first. Every input is
 * controlled, per CLAUDE.md: React 19 resets a form when its action returns,
 * and a bill somebody spent five minutes typing must survive a refusal.
 *
 * Money and quantities are text with a decimal comma, exactly as the bill
 * prints them. `draftToBody` is the one place they become numbers.
 *
 * **Two homes.** On a meter's page the meter is fixed. On the Energia screen
 * the form is handed every meter in the club and picks one itself: a bill read
 * off a PDF selects the meter whose CPE it names, and a person confirms or
 * corrects it in the picker. That is the reason `energy_meter.cpe` exists.
 */

/** A meter the form may file a bill on, with what it needs to match a CPE. */
export interface MeterOption {
  id: string;
  facilityId: string;
  label: string;
  cpe: string | null;
}

/** A site a new meter may be created at, when the bill's CPE matches none. */
export interface FacilityOption {
  id: string;
  name: string;
}

/** The picker's value for "make a meter from this bill". */
const NEW_METER = '__new__';

function isAccepted(file: File): boolean {
  const lower = file.name.toLowerCase();
  return Object.keys(REPORT_MEDIA_TYPES).some((extension) => lower.endsWith(extension));
}

/** A CPE as the schema compares it: no spaces, upper-case. */
function compactCpe(text: string | null): string {
  return (text ?? '').replace(/\s+/g, '').toUpperCase();
}

const INITIAL_READ: InvoiceReadState = { ok: false, attempt: 0 };
const INITIAL_SEND: InvoicePreviewState = { ok: false, attempt: 0 };

const BUTTON =
  'inline-flex h-control items-center gap-1.5 rounded border border-border-strong px-3 text-sm ' +
  'transition-colors hover:border-primary/50 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-primary';
const PRIMARY =
  'inline-flex h-control items-center gap-1.5 rounded bg-primary px-4 text-sm font-medium text-primary-foreground ' +
  'transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-primary';
const CELL = 'h-9 w-full rounded border border-border bg-surface px-2 text-sm tabular-nums';
const INVALID = 'border-danger';

export function InvoiceForm({
  meterId,
  facilityId,
  meterCpe,
  meters,
  facilities,
  importAvailable,
  collapsed = false,
  dropAnywhere = false,
}: {
  /** Fixed, on a meter's page. Absent when `meters` offers the choice. */
  meterId?: string;
  facilityId?: string;
  meterCpe?: string | null;
  /** Every meter a bill may be filed on — the Energia screen's way in. */
  meters?: MeterOption[];
  /**
   * Where a meter may be created when the bill's CPE matches none — the
   * first bill of a new club, or of a new supply. One site means no question.
   */
  facilities?: FacilityOption[];
  /** Whether the parser is on for this club — decided on the server. */
  importAvailable: boolean;
  /** Only the drop zone until a bill is read or the person asks for the form. */
  collapsed?: boolean;
  /**
   * Listen for a file dropped anywhere on the page. The Energia screen's
   * gesture and nobody else's — a meter's own page reached through the site
   * keeps to the file chooser, so the facility screens never swallow a drop.
   */
  dropAnywhere?: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const router = useRouter();

  const [selectedId, setSelectedId] = useState(meterId ?? '');
  const [newMeterFacilityId, setNewMeterFacilityId] = useState(
    facilities !== undefined && facilities.length === 1 ? facilities[0]!.id : '',
  );
  const creating = meters !== undefined && selectedId === NEW_METER;
  const selected: MeterOption | null =
    meters?.find((m) => m.id === selectedId) ??
    (meterId !== undefined && facilityId !== undefined
      ? { id: meterId, facilityId, label: '', cpe: meterCpe ?? null }
      : null);
  // Something to file on: an existing meter, or a site to make one at.
  const target = selected !== null || (creating && newMeterFacilityId !== '');

  const [open, setOpen] = useState(!collapsed);

  /*
   * Dropping a file anywhere on the page reads it — the gesture people try
   * first, and the reason `useFileDrop` listens on the window.
   *
   * **A drop that cannot be read says why.** The first version returned
   * silently when the parser was off or the file was not a document, and the
   * report was "dragging does not work": the overlay showed, the file landed,
   * nothing happened. Now the card says the parser is not on, or that this is
   * not a PDF or a photo, and the manual form is a click away.
   */
  const [dropNote, setDropNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const readForm = useRef<HTMLFormElement>(null);
  const { dragging } = useFileDrop((file) => {
    if (!dropAnywhere) return;
    if (!importAvailable) {
      setDropNote('energy.invoice.importDisabled');
      return;
    }
    if (!isAccepted(file)) {
      setDropNote('energy.invoice.chooseAFile');
      return;
    }
    if (fileInput.current === null) return;
    setDropNote(null);
    const transfer = new DataTransfer();
    transfer.items.add(file);
    fileInput.current.files = transfer.files;
    startTransition(() => readForm.current?.requestSubmit());
  });

  const [draft, setDraft] = useState<InvoiceDraft>(emptyInvoiceDraft);
  const [source, setSource] = useState<'manual' | 'import'>('manual');
  const [fileName, setFileName] = useState('');

  const [read, readAction, reading] = useSavedAction(readInvoiceFileAction, INITIAL_READ);
  const [preview, previewAction, previewing] = useSavedAction(previewInvoiceAction, INITIAL_SEND);
  const [commit, commitAction, committing] = useSavedAction(commitInvoiceAction, INITIAL_SEND);

  // The parser's answer becomes the form. Once per answer — identity, not a
  // boolean, so a re-render does not overwrite what the operator then edited.
  const seeded = useRef<unknown>(null);
  useEffect(() => {
    if (read.draft === undefined || seeded.current === read) return;
    seeded.current = read;
    setDraft(read.draft);
    setSource('import');
    setFileName(read.fileName ?? '');
    setOpen(true);
    // The bill names its delivery point; the meter carrying that CPE is the
    // one. None carrying it, and a site to make one at: propose that.
    if (meters !== undefined) {
      const cpe = compactCpe(read.draft.cpe);
      const match = cpe === '' ? undefined : meters.find((m) => compactCpe(m.cpe) === cpe);
      if (match !== undefined) setSelectedId(match.id);
      else if (facilities !== undefined && facilities.length > 0 && cpe !== '') setSelectedId(NEW_METER);
    }
  }, [read, meters, facilities]);

  // A commit that worked goes to the bill's own page — on the meter it was
  // filed on, which the action reports, since it may have just made it.
  useEffect(() => {
    if (commit.invoiceId !== undefined && commit.meterId !== undefined) {
      router.push(`/dashboard/facilities/energy/${commit.meterId}/invoices/${commit.invoiceId}`);
    }
  }, [commit.invoiceId, commit.meterId, router]);

  // Whichever came back last is what the form reports.
  const latest = commit.attempt >= preview.attempt ? commit : preview;
  const fields: Record<string, string> = { ...(latest.fields ?? {}), ...(latest.check?.fields ?? {}) };
  const check = preview.check;

  const patch = (changes: Partial<InvoiceDraft>): void => setDraft((d) => ({ ...d, ...changes }));
  const patchRegister = (i: number, changes: Partial<RegisterDraft>): void =>
    setDraft((d) => ({ ...d, registers: d.registers.map((r, j) => (j === i ? { ...r, ...changes } : r)) }));
  const patchLine = (i: number, changes: Partial<LineDraft>): void =>
    setDraft((d) => ({ ...d, lines: d.lines.map((l, j) => (j === i ? { ...l, ...changes } : l)) }));

  const hidden = (
    <>
      <input type="hidden" name="meterId" value={selected?.id ?? ''} />
      <input type="hidden" name="facilityId" value={selected?.facilityId ?? (creating ? newMeterFacilityId : '')} />
      <input type="hidden" name="newMeterFacilityId" value={creating ? newMeterFacilityId : ''} />
      <input type="hidden" name="source" value={source} />
      <input type="hidden" name="sourceFileName" value={fileName} />
      <input type="hidden" name="draft" value={JSON.stringify(draft)} />
    </>
  );

  const err = (field: string): string | undefined => fields[field];

  return (
    <div className="flex flex-col gap-6">
      {dropAnywhere && <DropOverlay shown={dragging} label={t('energy.invoice.dropLabel')} />}

      {/* ---- Importar ------------------------------------------------------ */}
      <section className="flex flex-col gap-3 rounded border border-dashed border-border p-4">
        <h3 className="text-sm font-medium">{t('energy.invoice.importTitle')}</h3>
        {importAvailable ? (
          <form ref={readForm} action={readAction} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className={FIELD_LABEL}>{t('energy.invoice.importFile')}</span>
              <input
                ref={fileInput}
                type="file"
                name="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp"
                required
                className="text-sm file:mr-3 file:rounded file:border file:border-border-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm"
              />
            </label>
            <button type="submit" disabled={reading} className={BUTTON}>
              <Upload className="size-4" aria-hidden="true" />
              {reading ? t('energy.invoice.reading') : t('energy.invoice.read')}
            </button>
            <p className="basis-full text-sm text-foreground-muted">{t('energy.invoice.importHint')}</p>
            {read.errorKey !== undefined && <p className="basis-full text-sm text-danger">{t(read.errorKey)}</p>}
            {read.ok && <p className="basis-full text-sm text-success">{t('energy.invoice.readOk', { file: read.fileName ?? '' })}</p>}
          </form>
        ) : (
          <p className="text-sm text-foreground-muted">{t('energy.invoice.importDisabled')}</p>
        )}
        {dropNote !== null && (
          <p className="flex items-start gap-1.5 text-sm text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t(dropNote)}
          </p>
        )}
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className={cn(BUTTON, 'self-start')}>
            <PenLine className="size-4" aria-hidden="true" />
            {t('energy.invoice.typeInstead')}
          </button>
        )}
      </section>

      {open && (<>

      {/* ---- Contador ------------------------------------------------------ */}
      {meters !== undefined && (
        <section className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('energy.invoice.meterLabel')}
            hint={
              creating
                ? t('energy.invoice.newMeterHint')
                : selected !== null && read.ok && compactCpe(read.draft?.cpe ?? null) !== '' && compactCpe(selected.cpe) === compactCpe(read.draft?.cpe ?? null)
                  ? t('energy.invoice.meterMatched')
                  : t('energy.invoice.meterHint')
            }
            required
          >
            {(id, cls) => (
              <select id={id} className={cls} value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
                <option value="">{t('energy.invoice.chooseMeter')}</option>
                {meters.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}{m.cpe !== null ? ` · ${m.cpe}` : ''}
                  </option>
                ))}
                {facilities !== undefined && facilities.length > 0 && (
                  <option value={NEW_METER}>{t('energy.invoice.newMeter')}</option>
                )}
              </select>
            )}
          </Field>
          {creating && facilities !== undefined && facilities.length > 1 && (
            <Field label={t('energy.invoice.newMeterSite')} required>
              {(id, cls) => (
                <select id={id} className={cls} value={newMeterFacilityId} onChange={(e) => setNewMeterFacilityId(e.target.value)}>
                  <option value="">—</option>
                  {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              )}
            </Field>
          )}
        </section>
      )}

      {/* ---- Cabeçalho ----------------------------------------------------- */}
      <section className="flex flex-col gap-4">
        <h3 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('energy.invoice.headerTitle')}
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t('energy.invoice.supplier')} error={err('supplier')} required>
            {(id, cls) => <input id={id} className={cls} value={draft.supplier} onChange={(e) => patch({ supplier: e.target.value })} />}
          </Field>
          <Field label={t('energy.invoice.number')} hint={t('energy.invoice.numberHint')} error={err('invoiceNumber')} required>
            {(id, cls) => <input id={id} className={cls} value={draft.invoiceNumber} onChange={(e) => patch({ invoiceNumber: e.target.value })} />}
          </Field>
          <Field label={t('energy.invoice.documentReference')} hint={t('energy.invoice.documentReferenceHint')} error={err('documentReference')}>
            {(id, cls) => <input id={id} className={cls} value={draft.documentReference} onChange={(e) => patch({ documentReference: e.target.value })} />}
          </Field>
          <Field label={t('energy.invoice.issuedOn')} error={err('issuedOn')} required>
            {(id, cls) => <input id={id} type="date" className={cls} value={draft.issuedOn} onChange={(e) => patch({ issuedOn: e.target.value })} />}
          </Field>
          <Field label={t('energy.invoice.periodStart')} error={err('periodStart')} required>
            {(id, cls) => <input id={id} type="date" className={cls} value={draft.periodStart} onChange={(e) => patch({ periodStart: e.target.value })} />}
          </Field>
          <Field label={t('energy.invoice.periodEnd')} error={err('periodEnd')} required>
            {(id, cls) => <input id={id} type="date" className={cls} value={draft.periodEnd} onChange={(e) => patch({ periodEnd: e.target.value })} />}
          </Field>
          <Field label={t('energy.invoice.dueOn')} error={err('dueOn')}>
            {(id, cls) => <input id={id} type="date" className={cls} value={draft.dueOn} onChange={(e) => patch({ dueOn: e.target.value })} />}
          </Field>
          <Field
            label={t('energy.invoice.cpe')}
            hint={
              selected === null
                ? undefined
                : selected.cpe === null
                  ? t('energy.invoice.cpeWillBeSet')
                  : t('energy.invoice.cpeOfMeter', { cpe: selected.cpe })
            }
            error={err('cpe')}
          >
            {(id, cls) => <input id={id} className={cls} value={draft.cpe} onChange={(e) => patch({ cpe: e.target.value })} />}
          </Field>
          <Field label={t('energy.invoice.meterSerial')} error={err('meterSerial')}>
            {(id, cls) => <input id={id} className={cls} value={draft.meterSerial} onChange={(e) => patch({ meterSerial: e.target.value })} />}
          </Field>
          <Field label={t('energy.invoice.contractedPower')} error={err('contractedPowerKva')}>
            {(id, cls) => <input id={id} className={cls} inputMode="decimal" value={draft.contractedPowerKva} onChange={(e) => patch({ contractedPowerKva: e.target.value })} />}
          </Field>
          <Field label={t('energy.invoice.tariff')} error={err('tariff')}>
            {(id, cls) => <input id={id} className={cls} value={draft.tariff} onChange={(e) => patch({ tariff: e.target.value })} />}
          </Field>
          <Field label={t('energy.invoice.cycle')} error={err('cycle')}>
            {(id, cls) => <input id={id} className={cls} value={draft.cycle} onChange={(e) => patch({ cycle: e.target.value })} />}
          </Field>
          <Field label={t('energy.invoice.readingQuality')} error={err('readingQuality')}>
            {(id, cls) => (
              <select id={id} className={cls} value={draft.readingQuality} onChange={(e) => patch({ readingQuality: e.target.value as InvoiceDraft['readingQuality'] })}>
                <option value="">—</option>
                <option value="real">{t('energy.invoice.real')}</option>
                <option value="estimated">{t('energy.invoice.estimated')}</option>
              </select>
            )}
          </Field>
          <Field label={t('energy.invoice.atcud')} error={err('atcud')}>
            {(id, cls) => <input id={id} className={cls} value={draft.atcud} onChange={(e) => patch({ atcud: e.target.value })} />}
          </Field>
        </div>
      </section>

      {/* ---- Contador ------------------------------------------------------ */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
            {t('energy.invoice.registersTitle')}
          </h3>
          <p className="text-sm text-foreground-muted">{t('energy.invoice.registersHint')}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-foreground-muted">
                <th className="py-1 pr-2 font-medium">{t('energy.invoice.register')}</th>
                <th className="py-1 pr-2 font-medium">{t('energy.invoice.previousIndex')}</th>
                <th className="py-1 pr-2 font-medium">{t('energy.invoice.currentIndex')}</th>
                <th className="py-1 pr-2 font-medium">kWh</th>
                <th className="py-1"><span className="sr-only">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {draft.registers.map((r, i) => (
                <tr key={r.register}>
                  <td className="py-1 pr-2">
                    <select
                      aria-label={t('energy.invoice.register')}
                      className={CELL}
                      value={r.register}
                      onChange={(e) => patchRegister(i, { register: e.target.value as RegisterName })}
                    >
                      {REGISTERS.map((name) => (
                        <option key={name} value={name} disabled={draft.registers.some((x, j) => j !== i && x.register === name)}>
                          {t(`energy.invoice.registers.${name}`)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pr-2">
                    <input aria-label={t('energy.invoice.previousIndex')} className={cn(CELL, err(`registers.${i}.previousIndex`) && INVALID)} inputMode="decimal" value={r.previousIndex} onChange={(e) => patchRegister(i, { previousIndex: e.target.value })} />
                  </td>
                  <td className="py-1 pr-2">
                    <input aria-label={t('energy.invoice.currentIndex')} className={cn(CELL, err(`registers.${i}.currentIndex`) && INVALID)} inputMode="decimal" value={r.currentIndex} onChange={(e) => patchRegister(i, { currentIndex: e.target.value })} />
                    {err(`registers.${i}.currentIndex`) !== undefined && (
                      <p className="mt-0.5 text-xs text-danger">{t(err(`registers.${i}.currentIndex`)!)}</p>
                    )}
                  </td>
                  <td className="py-1 pr-2">
                    <input aria-label="kWh" className={cn(CELL, err(`registers.${i}.kwh`) && INVALID)} inputMode="decimal" value={r.kwh} onChange={(e) => patchRegister(i, { kwh: e.target.value })} />
                  </td>
                  <td className="py-1">
                    <button type="button" aria-label={t('energy.invoice.removeRow')} title={t('energy.invoice.removeRow')} onClick={() => setDraft((d) => ({ ...d, registers: d.registers.filter((_, j) => j !== i) }))} className="text-foreground-muted hover:text-danger">
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {draft.registers.length < REGISTERS.length && (
          <button
            type="button"
            onClick={() => {
              const next = REGISTERS.find((name) => !draft.registers.some((r) => r.register === name));
              if (next !== undefined) setDraft((d) => ({ ...d, registers: [...d.registers, emptyRegister(next)] }));
            }}
            className={cn(BUTTON, 'self-start')}
          >
            <Plus className="size-4" aria-hidden="true" />
            {t('energy.invoice.addRegister')}
          </button>
        )}
      </section>

      {/* ---- Linhas -------------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
            {t('energy.invoice.linesTitle')}
          </h3>
          <p className="text-sm text-foreground-muted">{t('energy.invoice.linesHint')}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[64rem] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-foreground-muted">
                <th className="py-1 pr-2 font-medium">{t('energy.invoice.lineKind')}</th>
                <th className="py-1 pr-2 font-medium">{t('energy.invoice.description')}</th>
                <th className="py-1 pr-2 font-medium">{t('energy.invoice.period')}</th>
                <th className="py-1 pr-2 font-medium">{t('energy.invoice.from')}</th>
                <th className="py-1 pr-2 font-medium">{t('energy.invoice.to')}</th>
                <th className="py-1 pr-2 font-medium">{t('energy.invoice.quantity')}</th>
                <th className="py-1 pr-2 font-medium">{t('energy.invoice.unit')}</th>
                <th className="py-1 pr-2 font-medium">{t('energy.invoice.unitPrice')}</th>
                <th className="py-1 pr-2 font-medium">{t('energy.invoice.amount')}</th>
                <th className="py-1 pr-2 font-medium">{t('energy.invoice.discount')}</th>
                <th className="py-1 pr-2 font-medium">{t('energy.invoice.lineTotal')}</th>
                <th className="py-1 pr-2 font-medium">IVA %</th>
                <th className="py-1"><span className="sr-only">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {draft.lines.map((l, i) => (
                <tr key={i} className="align-top">
                  <td className="py-1 pr-2">
                    <select aria-label={t('energy.invoice.lineKind')} className={CELL} value={l.kind} onChange={(e) => patchLine(i, { kind: e.target.value as LineKind })}>
                      {LINE_KINDS.map((kind) => <option key={kind} value={kind}>{t(`energy.invoice.kinds.${kind}`)}</option>)}
                    </select>
                  </td>
                  <td className="py-1 pr-2">
                    <input aria-label={t('energy.invoice.description')} className={cn(CELL, 'min-w-[12rem]', err(`lines.${i}.description`) && INVALID)} value={l.description} onChange={(e) => patchLine(i, { description: e.target.value })} />
                  </td>
                  <td className="py-1 pr-2">
                    <select aria-label={t('energy.invoice.period')} className={CELL} value={l.period} onChange={(e) => patchLine(i, { period: e.target.value as LineDraft['period'] })}>
                      <option value="">—</option>
                      {TARIFF_PERIODS.map((p) => <option key={p} value={p}>{t(`energy.invoice.periods.${p}`)}</option>)}
                    </select>
                  </td>
                  <td className="py-1 pr-2"><input aria-label={t('energy.invoice.from')} type="date" className={CELL} value={l.fromOn} onChange={(e) => patchLine(i, { fromOn: e.target.value })} /></td>
                  <td className="py-1 pr-2"><input aria-label={t('energy.invoice.to')} type="date" className={CELL} value={l.toOn} onChange={(e) => patchLine(i, { toOn: e.target.value })} /></td>
                  <td className="py-1 pr-2"><input aria-label={t('energy.invoice.quantity')} className={cn(CELL, 'w-20', err(`lines.${i}.quantity`) && INVALID)} inputMode="decimal" value={l.quantity} onChange={(e) => patchLine(i, { quantity: e.target.value })} /></td>
                  <td className="py-1 pr-2"><input aria-label={t('energy.invoice.unit')} className={cn(CELL, 'w-16')} value={l.unit} onChange={(e) => patchLine(i, { unit: e.target.value })} /></td>
                  <td className="py-1 pr-2"><input aria-label={t('energy.invoice.unitPrice')} className={cn(CELL, 'w-24', err(`lines.${i}.unitPrice`) && INVALID)} inputMode="decimal" value={l.unitPrice} onChange={(e) => patchLine(i, { unitPrice: e.target.value })} /></td>
                  <td className="py-1 pr-2"><input aria-label={t('energy.invoice.amount')} className={cn(CELL, 'w-24', err(`lines.${i}.amount`) && INVALID)} inputMode="decimal" value={l.amount} onChange={(e) => patchLine(i, { amount: e.target.value })} /></td>
                  <td className="py-1 pr-2"><input aria-label={t('energy.invoice.discount')} className={cn(CELL, 'w-20', err(`lines.${i}.discount`) && INVALID)} inputMode="decimal" value={l.discount} onChange={(e) => patchLine(i, { discount: e.target.value })} /></td>
                  <td className="py-1 pr-2"><input aria-label={t('energy.invoice.lineTotal')} className={cn(CELL, 'w-24', err(`lines.${i}.total`) && INVALID)} inputMode="decimal" value={l.total} onChange={(e) => patchLine(i, { total: e.target.value })} /></td>
                  <td className="py-1 pr-2"><input aria-label="IVA %" className={cn(CELL, 'w-16', err(`lines.${i}.vatRate`) && INVALID)} inputMode="decimal" value={l.vatRate} onChange={(e) => patchLine(i, { vatRate: e.target.value })} /></td>
                  <td className="py-1">
                    <button type="button" aria-label={t('energy.invoice.removeRow')} title={t('energy.invoice.removeRow')} onClick={() => setDraft((d) => ({ ...d, lines: d.lines.filter((_, j) => j !== i) }))} className="mt-2 text-foreground-muted hover:text-danger">
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" onClick={() => setDraft((d) => ({ ...d, lines: [...d.lines, emptyLine('energy')] }))} className={cn(BUTTON, 'self-start')}>
          <Plus className="size-4" aria-hidden="true" />
          {t('energy.invoice.addLine')}
        </button>
      </section>

      {/* ---- Totais -------------------------------------------------------- */}
      <section className="flex flex-col gap-4">
        <h3 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('energy.invoice.totalsTitle')}
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('energy.invoice.subtotal')} hint={t('energy.invoice.subtotalHint')} error={err('subtotal') ?? err('subtotalCents')} required>
            {(id, cls) => <input id={id} className={cls} inputMode="decimal" value={draft.subtotal} onChange={(e) => patch({ subtotal: e.target.value })} />}
          </Field>
          <Field label={t('energy.invoice.vat')} error={err('vat') ?? err('vatCents')} required>
            {(id, cls) => <input id={id} className={cls} inputMode="decimal" value={draft.vat} onChange={(e) => patch({ vat: e.target.value })} />}
          </Field>
          <Field label={t('energy.invoice.total')} hint={t('energy.invoice.totalHint')} error={err('total') ?? err('totalCents')} required>
            {(id, cls) => <input id={id} className={cls} inputMode="decimal" value={draft.total} onChange={(e) => patch({ total: e.target.value })} />}
          </Field>
          <Field label={t('energy.invoice.otherCharges')} hint={t('energy.invoice.otherChargesHint')} error={err('otherCharges') ?? err('otherChargesCents')}>
            {(id, cls) => <input id={id} className={cls} inputMode="decimal" value={draft.otherCharges} onChange={(e) => patch({ otherCharges: e.target.value })} />}
          </Field>
          <Field label={t('energy.invoice.documentTotal')} hint={t('energy.invoice.documentTotalHint')} error={err('documentTotal') ?? err('documentTotalCents')}>
            {(id, cls) => <input id={id} className={cls} inputMode="decimal" value={draft.documentTotal} onChange={(e) => patch({ documentTotal: e.target.value })} />}
          </Field>
          <Field label={t('energy.invoice.networkAccess')} error={err('networkAccess')}>
            {(id, cls) => <input id={id} className={cls} inputMode="decimal" value={draft.networkAccess} onChange={(e) => patch({ networkAccess: e.target.value })} />}
          </Field>
          <Field label={t('energy.invoice.regulatedDifference')} hint={t('energy.invoice.regulatedDifferenceHint')} error={err('regulatedDifference')}>
            {(id, cls) => <input id={id} className={cls} inputMode="decimal" value={draft.regulatedDifference} onChange={(e) => patch({ regulatedDifference: e.target.value })} />}
          </Field>
        </div>
        <Field label={t('energy.invoice.notes')} error={err('notes')}>
          {(id, cls) => <textarea id={id} rows={2} className={cn(cls, 'h-auto py-2')} value={draft.notes} onChange={(e) => patch({ notes: e.target.value })} />}
        </Field>
      </section>

      {/* ---- Verificação --------------------------------------------------- */}
      {check !== undefined && (
        <section className="flex flex-col gap-2 rounded border border-border bg-surface-muted p-4 text-sm">
          <p>
            {t('energy.invoice.checkSummary', { billed: check.billedKwh, registers: check.registerKwh })}
          </p>
          {check.willSetCpe && <p className="text-foreground-muted">{t('energy.invoice.willSetCpe')}</p>}
          {check.warnings.length > 0 && (
            <ul className="flex flex-col gap-1">
              {check.warnings.map((w) => (
                <li key={w.key + JSON.stringify(w.values)} className="flex items-start gap-1.5 text-warning">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>{t(w.key, w.values)}</span>
                </li>
              ))}
            </ul>
          )}
          {Object.keys(check.fields).length === 0 ? (
            <p className="text-success">{t('energy.invoice.checkOk')}</p>
          ) : (
            <p className="text-danger">{t('common.checkTheFields')}</p>
          )}
        </section>
      )}

      {latest.errorKey !== undefined && <p className="text-sm text-danger">{t(latest.errorKey)}</p>}

      {!target && <p className="text-sm text-foreground-muted">{t('energy.invoice.chooseMeterFirst')}</p>}
      {creating && target && <p className="text-sm text-foreground-muted">{t('energy.invoice.newMeterNoPreview')}</p>}

      <div className="flex flex-wrap gap-2">
        <form action={previewAction}>
          {hidden}
          <button type="submit" disabled={previewing || committing || !target || creating} className={BUTTON}>
            <FileSearch className="size-4" aria-hidden="true" />
            {previewing ? t('common.working') : t('energy.invoice.verify')}
          </button>
        </form>
        <form action={commitAction}>
          {hidden}
          <button type="submit" disabled={previewing || committing || !target} className={PRIMARY}>
            <Check className="size-4" aria-hidden="true" />
            {committing ? t('common.working') : t('energy.invoice.file')}
          </button>
        </form>
      </div>
      </>)}
    </div>
  );
}

/** A labelled control with its hint and its error, controlled by the caller. */
function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  required?: boolean;
  children: (id: string, className: string) => React.ReactNode;
}): React.ReactElement {
  const t = useTranslations();
  const id = `f-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={FIELD_LABEL}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {children(id, cn(CONTROL_LINE, error !== undefined && INVALID))}
      {hint !== undefined && <p className="text-xs text-foreground-muted">{hint}</p>}
      {error !== undefined && <p className="text-xs text-danger">{t(error)}</p>}
    </div>
  );
}
