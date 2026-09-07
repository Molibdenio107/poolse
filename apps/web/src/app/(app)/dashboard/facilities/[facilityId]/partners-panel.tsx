'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Download, FileSpreadsheet, Plus, Upload } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import { formatCents } from '@/lib/money';
import type { PartnerRow, PartnerType } from '@/lib/api';
import { SelectField, TextField } from '@/components/ui/field';
import { Dialog } from '@/components/ui/dialog';
import { DropOverlay, useFileDrop } from '@/components/file-drop';
import { PartnerImportWizard } from './partner-import-wizard';
import { withFrom } from '@/lib/back';
import type { FormState } from '../../actions';
import { savePartnerAction } from './partners.actions';

/**
 * Parcerias, on the facility page — POOLSE-47.
 *
 * A fifth stacked section beside Configuração and the tabela de preços, because
 * a partnership is an agreement with *this building*: the price, the contact and
 * the contract are all per site. A tab bar introduced for one ticket would be a
 * navigation pattern the rest of the page does not use.
 *
 * **The colour is never the information.** Every row carries the partner's name
 * as text and its type as a word; the swatch sits beside them and repeats what
 * they already say. That is the standing rule, and this is the screen where it
 * would be most tempting to break it — a grid keyed only by colour is exactly
 * what the club's paper timetable does, and exactly what somebody who cannot
 * distinguish the two greens cannot read.
 *
 * **Zero renders as 0.** A partner with no hours booked yet is the ordinary
 * state on the day this ships, and an empty cell is indistinguishable from a
 * column that failed to load.
 */

const INITIAL: FormState = { ok: false };

const PARTNER_TYPES: readonly PartnerType[] = [
  'escola',
  'agrupamento',
  'ipss_misericordia',
  'jardim_infancia',
  'clube',
  'camara',
  'empresa',
  'outro',
];

const BUTTON =
  'h-control rounded bg-primary px-4 text-sm text-primary-foreground disabled:opacity-60 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const BUTTON_QUIET =
  'inline-flex h-control items-center gap-2 rounded border border-border px-3 text-sm hover:bg-surface-muted ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** What the reader can actually open. A `.pdf` dropped here is a mistake, said so. */
const ACCEPTED = ['.xlsx', '.csv'];

function isAccepted(file: File): boolean {
  const name = file.name.toLowerCase();
  return ACCEPTED.some((extension) => name.endsWith(extension));
}

/**
 * Hours, to one decimal place, in the reader's locale.
 *
 * 0.75 is "0,75 h" in pt-PT and "0.75 h" in en, which is the whole reason this
 * goes through the locale rather than through `toFixed`.
 */
function formatHours(locale: string, hours: number): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(hours);
}

export function PartnersPanel({
  facilityId,
  facilityName,
  partners,
  total,
  canManage,
}: {
  facilityId: string;
  /** Named on the importer, because a partnership belongs to one building. */
  facilityName: string;
  partners: PartnerRow[];
  total: number;
  canManage: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [state, save, pending] = useSavedAction(savePartnerAction, INITIAL);

  /*
   * The importer — POOLSE-48, criterion 1.
   *
   * The whole screen is the drop target rather than a bordered rectangle
   * somewhere down the page: a zone people miss is a zone whose miss makes the
   * browser navigate away to render the spreadsheet, losing the page they were
   * on. `useFileDrop` counts drag depth so the overlay does not flicker across
   * child elements.
   *
   * **A drop asks before anything is read.** Files get dragged by accident, and
   * a screen that starts reading one nobody meant to give it is a screen people
   * stop dragging onto. The question goes through the app's dialog, so Escape
   * closes it and focus comes back to where it was.
   */
  const [importing, setImporting] = useState(false);
  const [dropped, setDropped] = useState<File | null>(null);
  /** The file the wizard should open on, once the operator has said yes to it. */
  const [accepted, setAccepted] = useState<File | null>(null);

  const onFile = useCallback((file: File) => {
    if (!canManage) return;
    setDropped(file);
  }, [canManage]);
  const { dragging } = useFileDrop(onFile);

  return (
    <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
            {t('partners.title')}
          </h2>
          {/*
            Said out loud, because it is the thing an operator gets wrong: a
            partner belongs to one building. The same school using two of the
            club's pools is two partnerships, with two agreements and two prices.
          */}
          <p className="mt-1 text-sm text-foreground-muted">{t('partners.perSite')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/*
            Export is owner/admin, matching the API — a partner sheet carries
            every school the club works with and its coordinators' telephone
            numbers. Ordinary links rather than buttons, because the answer is a
            file: the browser does what browsers do with an attachment, and it
            works with no JavaScript at all.
          */}
          {canManage && partners.length > 0 && (
            <>
              <a
                href={`/dashboard/facilities/${facilityId}/partners/export?format=xlsx`}
                className={BUTTON_QUIET}
              >
                <Download className="size-4" aria-hidden />
                {t('partnerImport.exportXlsx')}
              </a>
              <a
                href={`/dashboard/facilities/${facilityId}/partners/export?format=csv`}
                className={BUTTON_QUIET}
              >
                <Download className="size-4" aria-hidden />
                {t('partnerImport.exportCsv')}
              </a>
            </>
          )}

          {canManage && (
            <button
              type="button"
              onClick={() => {
                setAccepted(null);
                setImporting((was) => !was);
              }}
              aria-expanded={importing}
              className={BUTTON_QUIET}
            >
              <Upload className="size-4" aria-hidden />
              {t('partnerImport.open')}
            </button>
          )}

          {canManage && (
            <button type="button" onClick={() => setOpen((was) => !was)} className={BUTTON_QUIET}>
              <Plus className="size-4" aria-hidden />
              {t('partners.add')}
            </button>
          )}
        </div>
      </div>

      {canManage && <DropOverlay shown={dragging} label={t('partnerImport.dropHere')} />}

      {/*
        The question a drop gets before anything is read — criterion 1, QA 48.9
        and 48.10. A file type the reader cannot open is told so here and offered
        only a way out, rather than being read and failing four steps later.
      */}
      <Dialog
        open={dropped !== null}
        onClose={() => setDropped(null)}
        title={t('partnerImport.confirmTitle')}
        description={dropped?.name ?? ''}
        closeLabel={t('common.cancel')}
      >
        {dropped !== null && !isAccepted(dropped) ? (
          <div className="flex flex-col gap-4">
            <p className="flex items-start gap-2 text-sm text-danger">
              <FileSpreadsheet aria-hidden className="mt-0.5 size-4 shrink-0" />
              {t('students.import.errorFileType')}
            </p>
            <button type="button" onClick={() => setDropped(null)} className={BUTTON_QUIET}>
              {t('common.cancel')}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-foreground-muted">{t('partnerImport.confirmHint')}</p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  setAccepted(dropped);
                  setDropped(null);
                  setImporting(true);
                }}
                className={BUTTON}
              >
                {t('partnerImport.confirmRead')}
              </button>
              <button type="button" onClick={() => setDropped(null)} className={BUTTON_QUIET}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}
      </Dialog>

      {importing && canManage && (
        <div className="rounded border border-border bg-surface-muted p-4">
          <PartnerImportWizard
            /*
              Remounted per opening and per accepted file, so a second import
              never starts on the first one's leftovers. `restart()` inside the
              wizard clears its own state; the key clears everything, including
              the action states React holds outside it.
            */
            key={accepted?.name ?? 'picker'}
            facilityId={facilityId}
            facilityName={facilityName}
            initialFile={accepted}
            onClose={() => {
              setAccepted(null);
              setImporting(false);
            }}
          />
        </div>
      )}

      {open && canManage && (
        <form
          action={save}
          className="flex flex-col gap-4 rounded border border-border bg-surface-muted p-4"
        >
          <input type="hidden" name="facilityId" value={facilityId} />

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              name="name"
              label={t('partners.name')}
              required
              maxLength={160}
              error={state.fields?.['name'] ? t(state.fields['name']) : undefined}
            />

            <SelectField
              name="type"
              label={t('partners.type')}
              initial="escola"
              options={PARTNER_TYPES.map((type) => ({
                value: type,
                label: t(`partners.kind.${type}`),
              }))}
            />

            <TextField
              name="nif"
              label={t('partners.nif')}
              maxLength={9}
              hint={t('partners.nifHint')}
              error={state.fields?.['nif'] ? t(state.fields['nif']) : undefined}
            />

            {/*
              A colour input, and the label says what it is for. It tints the
              partner's cells on the lane grid; it never carries the meaning on
              its own, because the cell shows the group's name as well.
            */}
            <TextField
              name="color"
              label={t('partners.color')}
              type="color"
              initial="#67a6b6"
              hint={t('partners.colorHint')}
            />
          </div>


          <div className="flex gap-2">
            <button type="submit" disabled={pending} className={BUTTON}>
              {t('common.save')}
            </button>
            <button type="button" onClick={() => setOpen(false)} className={BUTTON_QUIET}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}

      {partners.length === 0 ? (
        <p className="text-sm text-foreground-muted">{t('partners.none')}</p>
      ) : (
        /*
          A table, and it scrolls inside itself rather than making the page
          scroll sideways — five numeric columns do not fit a narrow window and
          shrinking them to fit would make the figures unreadable.
        */
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-foreground-muted">
                <th scope="col" className="py-2 pr-4 font-medium">{t('partners.name')}</th>
                <th scope="col" className="py-2 pr-4 font-medium">{t('partners.type')}</th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  {t('partners.groupCount')}
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  {t('partners.weeklyHours')}
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  {t('partners.weeklyLaneHours')}
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">
                  {t('partners.contracted')}
                </th>
                <th scope="col" className="py-2 font-medium">{t('partners.status')}</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-border">
              {partners.map((partner) => (
                <tr key={partner.id}>
                  <td className="py-2 pr-4">
                    <Link
                      href={withFrom(
                        `/dashboard/facilities/partners/${partner.id}`,
                        `/dashboard/facilities/${facilityId}`,
                      )}
                      className="inline-flex items-center gap-2 rounded font-medium hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      {/*
                        Decorative, and marked so. The name beside it is the
                        information; a screen reader announcing "colour swatch"
                        before every row would be noise. The border keeps a pale
                        colour visible against the surface in both themes.
                      */}
                      <span
                        aria-hidden
                        className="size-3 shrink-0 rounded-sm border border-border"
                        style={{ backgroundColor: partner.color }}
                      />
                      {partner.name}
                    </Link>
                  </td>

                  <td className="py-2 pr-4 text-foreground-muted">
                    {t(`partners.kind.${partner.type}`)}
                  </td>

                  <td className="py-2 pr-4 text-right tabular-nums">{partner.groupCount}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatHours(locale, partner.weeklyHours)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatHours(locale, partner.weeklyLaneHours)}
                  </td>

                  <td className="py-2 pr-4 text-right tabular-nums">
                    {/*
                      An em dash for "no agreement recorded", which is a
                      different fact from "€0,00 agreed" and must not look like
                      it.
                    */}
                    {partner.contractedCents === null
                      ? '—'
                      : formatCents(locale, partner.contractedCents)}
                  </td>

                  <td className="py-2">
                    <span
                      className={
                        partner.status === 'ativa'
                          ? 'text-foreground-muted'
                          : 'rounded border border-border px-2 py-0.5 text-xs text-foreground-muted'
                      }
                    >
                      {t(`partners.state.${partner.status}`)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/*
        The count is said in words as well as being implied by the rows, because
        the list is paginated and "8 of 23" is the thing the reader needs in
        order to know the page is not everything.
      */}
      {total > partners.length && (
        <p className="text-sm text-foreground-muted">
          {t('partners.showing', { shown: partners.length, total })}
        </p>
      )}
    </section>
  );
}
