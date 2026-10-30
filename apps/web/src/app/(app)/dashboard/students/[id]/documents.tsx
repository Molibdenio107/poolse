'use client';

import { startTransition, useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Camera, Printer, Sparkles } from 'lucide-react';
import { DropOverlay, useFileDrop } from '@/components/file-drop';
import { acceptFor } from '@/lib/files';
import { FromLink } from '@/components/from-link';
import { DocumentLink, FileUpload } from '@/components/file-upload';
import { SelectField, TextField, useSeeded, useSuccessKey } from '@/components/ui/field';
import { sectionHref } from '@/components/section-pills';
import { formatDate } from '@/lib/date-format';
import { useSavedAction } from '@/lib/saved';
import { FPN_DISCIPLINES, type FpnDiscipline, type StudentDocuments } from '@/lib/fpn-forms';
import type { FormState } from '../../actions';
import {
  saveDisciplinesAction,
  saveFpnSettingsAction,
  saveIdDocumentAction,
  uploadIdPhotoAction,
  type IdPhotoState,
} from './documents.actions';

/**
 * *Documentos* on the student's record — POOLSE-132.
 *
 * The identification document's details (the number is never sent to the
 * screen: "registado" says one is on file, and typing replaces it), and the
 * two FPN sections: the disciplines the print ticks, the season it names, what
 * it would print blank, the print itself and the signed copies filed per
 * season. Owner and admin only, decided by the API.
 */

const INITIAL: FormState = { ok: false };

const BUTTON =
  'inline-flex h-control items-center justify-center gap-2 rounded px-4 text-control disabled:opacity-60';
const PRIMARY = `${BUTTON} bg-primary text-primary-foreground hover:bg-primary/90`;
const SECONDARY = `${BUTTON} border border-border bg-surface hover:bg-surface-muted`;
const CARD = 'flex flex-col gap-3 rounded border border-border bg-surface p-5';
const HEADING = 'text-sm font-medium uppercase tracking-wider text-foreground-muted';

const ID_TYPES = ['cc', 'bi', 'passport', 'other'] as const;

export function IdDocumentForm({
  studentId,
  idDocument,
  proposal = null,
  fullNumber = null,
}: {
  studentId: string;
  idDocument: StudentDocuments['idDocument'];
  /** The number in full, as the General tab shows it (owner and admin). */
  fullNumber?: string | null;
  /** Read from the photograph, for a person to confirm (30-10-2026). */
  proposal?: NonNullable<IdPhotoState['proposal']> | null;
}): React.ReactElement {
  const t = useTranslations();
  const [state, dispatch, isPending] = useSavedAction(saveIdDocumentAction, INITIAL);
  // A number typed and saved leaves the box: the screen never keeps it.
  const saved = useSuccessKey(state);
  const error = (field: string): string | undefined => {
    const key = state.fields?.[field];
    return key === undefined ? undefined : t(key);
  };

  return (
    <form action={dispatch} className={CARD}>
      <h3 className={HEADING}>{t('documents.idDocument.title')}</h3>
      {proposal !== null && (
        <p className="flex items-start gap-2 rounded border border-primary/40 bg-primary/10 p-3 text-sm">
          <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t('documents.idPhoto.proposed')}
        </p>
      )}
      <input type="hidden" name="studentId" value={studentId} />
      <div className="flex flex-wrap gap-4">
        <SelectField
          name="idDocumentType"
          label={t('documents.idDocument.type')}
          initial={proposal?.type ?? idDocument.type ?? ''}
          options={[
            { value: '', label: t('documents.idDocument.typeNone') },
            ...ID_TYPES.map((type) => ({ value: type, label: t(`documents.idDocument.types.${type}`) })),
          ]}
          error={error('idDocumentType')}
        />
        <TextField
          key={saved}
          name="idDocumentNumber"
          initial={proposal?.number ?? fullNumber ?? ''}
          label={t('documents.idDocument.number')}
          autoComplete="off"
          maxLength={30}
          {...(idDocument.hasNumber ? { placeholder: t('documents.idDocument.numberOnFilePlaceholder') } : {})}
          hint={idDocument.hasNumber ? t('documents.idDocument.numberOnFile') : t('documents.idDocument.numberNone')}
          error={error('idDocumentNumber')}
        />
      </div>
      <div className="flex flex-wrap gap-4">
        <TextField
          name="idDocumentIssuedOn"
          type="date"
          label={t('documents.idDocument.issuedOn')}
          initial={proposal?.issuedOn ?? idDocument.issuedOn ?? ''}
          hint={t('documents.idDocument.issuedOnHint')}
          error={error('idDocumentIssuedOn')}
        />
        <TextField
          name="idDocumentValidUntil"
          type="date"
          label={t('documents.idDocument.validUntil')}
          initial={proposal?.validUntil ?? idDocument.validUntil ?? ''}
          error={error('idDocumentValidUntil')}
        />
      </div>
      <div>
        <button type="submit" disabled={isPending} className={PRIMARY}>
          {isPending ? t('common.working') : t('common.save')}
        </button>
      </div>
    </form>
  );
}

/**
 * One FPN section — the adult declaration or the minors' one. The season is
 * this screen's own choice (published first), and it names both the print and
 * the file a signed copy goes under.
 */
export function FpnSection({
  studentId,
  kind,
  documents,
  storageReady,
}: {
  studentId: string;
  kind: 'fpn_declaration' | 'fpn_declaration_minor';
  documents: StudentDocuments;
  storageReady: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const { seasons } = documents;
  const initialSeason = (seasons.find((season) => season.published) ?? seasons[0])?.id ?? '';
  const [seasonId, setSeasonId] = useState(initialSeason);
  const minor = kind === 'fpn_declaration_minor';

  const seasonName = (id: string | null): string =>
    seasons.find((season) => season.id === id)?.name ?? t('documents.fpn.seasonUnknown');
  const mine = documents.copies.filter((copy) => copy.kind === kind);
  const current = mine.find((copy) => copy.seasonId === seasonId && copy.replacedAt === null);

  // Each season with something filed, in the list's order, then any the list no longer holds.
  const listed = seasons.map((season) => season.id);
  const filedSeasons = [
    ...listed.filter((id) => mine.some((copy) => copy.seasonId === id)),
    ...[...new Set(mine.map((copy) => copy.seasonId))].filter((id) => id === null || !listed.includes(id)),
  ];

  const base = `/dashboard/students/${studentId}`;
  const missingHref = (key: string): string => {
    switch (key) {
      case 'addressLine':
      case 'locality':
      case 'postalCode':
        return `${base}?tab=general`;
      case 'idDocumentNumber':
      case 'idDocumentValidUntil':
        return sectionHref(base, { tab: 'document' }, 'identificacao');
      case 'disciplines':
        return '#fpn-disciplines';
      default:
        return '#fpn-club';
    }
  };

  const printHref = `${base}/documentos/fpn?${new URLSearchParams({
    ...(seasonId === '' ? {} : { season: seasonId }),
    ...(minor ? { minor: '1' } : {}),
    print: '1',
  }).toString()}`;

  return (
    <div className="flex flex-col gap-4">
      <section className={CARD}>
        <h3 className={HEADING}>{t(minor ? 'documents.fpn.titleMinor' : 'documents.fpn.title')}</h3>
        <p className="text-sm text-foreground-muted">
          {t(minor ? 'documents.fpn.introMinor' : 'documents.fpn.intro')}
        </p>
        {seasons.length === 0 ? (
          <p className="text-sm">{t('documents.fpn.noSeasons')}</p>
        ) : (
          <>
            <SelectField
              name="season"
              label={t('documents.fpn.season')}
              initial={initialSeason}
              options={seasons.map((season) => ({
                value: season.id,
                label: season.published ? t('documents.fpn.seasonPublished', { name: season.name }) : season.name,
              }))}
              onValueChange={setSeasonId}
            />
            <p className="text-sm">
              {current === undefined
                ? t('documents.fpn.stateMissing', { season: seasonName(seasonId) })
                : t('documents.fpn.stateFiled', { season: seasonName(seasonId), date: formatDate(current.filedAt) })}
            </p>
          </>
        )}
      </section>

      <DisciplinesForm studentId={studentId} disciplines={documents.disciplines} />

      <FpnClubForm studentId={studentId} club={documents.club} />

      {seasons.length > 0 && (
        <section className={CARD}>
          <h3 className={HEADING}>{t('documents.fpn.printTitle')}</h3>
          {documents.missing.length === 0 ? (
            <p className="text-sm text-foreground-muted">{t('documents.fpn.nothingMissing')}</p>
          ) : (
            <div className="flex flex-col gap-1">
              <p className="text-sm">{t('documents.fpn.missingIntro')}</p>
              <ul className="list-disc pl-5 text-sm">
                {documents.missing.map((key) => (
                  <li key={key}>
                    {missingHref(key).startsWith('#') ? (
                      <a href={missingHref(key)} className="text-primary underline-offset-2 hover:underline">
                        {t(`documents.missing.${key}`)}
                      </a>
                    ) : (
                      <FromLink href={missingHref(key)} className="text-primary underline-offset-2 hover:underline">
                        {t(`documents.missing.${key}`)}
                      </FromLink>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {minor && documents.minor === true && (
            <p className="text-sm text-foreground-muted">{t('documents.fpn.signerMinor')}</p>
          )}
          <div>
            {/*
              A plain anchor in its own tab, as the meet sheet's (POOLSE-115):
              `Link` would prefetch it, and reading it decrypts the ID number
              and writes that to the audit log.
            */}
            <a href={printHref} target="_blank" rel="noopener" className={SECONDARY}>
              <Printer className="size-4" aria-hidden />
              {t('documents.fpn.print')}
            </a>
          </div>
        </section>
      )}

      {seasons.length > 0 && (
        <section className={CARD}>
          <h3 className={HEADING}>{t('documents.fpn.signedTitle')}</h3>
          <FileUpload
            key={seasonId}
            target={`student-document:${studentId}:${kind}:${seasonId}`}
            label={t('documents.fpn.upload', { season: seasonName(seasonId) })}
            hint={t('files.documentHint')}
            unavailable={storageReady ? null : t('files.notConfigured')}
          />
          {filedSeasons.length === 0 ? (
            <p className="text-sm text-foreground-muted">{t('documents.fpn.noneFiled')}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {filedSeasons.map((id) => (
                <li key={id ?? 'none'} className="flex flex-col gap-1">
                  <span className="font-medium">{t('documents.fpn.seasonHeading', { season: seasonName(id) })}</span>
                  <ul className="flex flex-col divide-y divide-border">
                    {mine
                      .filter((copy) => copy.seasonId === id)
                      .map((copy) => (
                        <li
                          key={copy.id}
                          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-1.5 text-sm"
                        >
                          <span>
                            {t('documents.fpn.filedLine', {
                              date: formatDate(copy.filedAt),
                              name: copy.filedByName ?? t('documents.fpn.someone'),
                            })}
                            {' · '}
                            <span className="text-foreground-muted">
                              {copy.replacedAt === null
                                ? t('documents.fpn.current')
                                : t('documents.fpn.replaced', { date: formatDate(copy.replacedAt) })}
                            </span>
                          </span>
                          <DocumentLink fileId={copy.fileId} quiet />
                        </li>
                      ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function DisciplinesForm({
  studentId,
  disciplines,
}: {
  studentId: string;
  disciplines: FpnDiscipline[];
}): React.ReactElement {
  const t = useTranslations();
  const [, dispatch, isPending] = useSavedAction(saveDisciplinesAction, INITIAL);
  return (
    <form id="fpn-disciplines" action={dispatch} className={CARD}>
      <h3 className={HEADING}>{t('documents.fpn.disciplines')}</h3>
      <input type="hidden" name="studentId" value={studentId} />
      <p className="text-sm text-foreground-muted">{t('documents.fpn.disciplinesHint')}</p>
      <fieldset className="flex flex-wrap gap-x-5 gap-y-2">
        <legend className="sr-only">{t('documents.fpn.disciplines')}</legend>
        {FPN_DISCIPLINES.map((discipline) => (
          <DisciplineBox key={discipline} discipline={discipline} on={disciplines.includes(discipline)} />
        ))}
      </fieldset>
      <div>
        <button type="submit" disabled={isPending} className={PRIMARY}>
          {isPending ? t('common.working') : t('common.save')}
        </button>
      </div>
    </form>
  );
}

function DisciplineBox({ discipline, on }: { discipline: FpnDiscipline; on: boolean }): React.ReactElement {
  const t = useTranslations();
  const [checked, setChecked] = useSeeded(on);
  return (
    <label className="inline-flex min-h-control items-center gap-2 text-control">
      <input
        type="checkbox"
        name="discipline"
        value={discipline}
        checked={checked}
        onChange={(event) => setChecked(event.target.checked)}
        className="size-4"
      />
      {t(`documents.discipline.${discipline}`)}
    </label>
  );
}

function FpnClubForm({
  studentId,
  club,
}: {
  studentId: string;
  club: StudentDocuments['club'];
}): React.ReactElement {
  const t = useTranslations();
  const [state, dispatch, isPending] = useSavedAction(saveFpnSettingsAction, INITIAL);
  const error = (field: string): string | undefined => {
    const key = state.fields?.[field];
    return key === undefined ? undefined : t(key);
  };
  return (
    <form id="fpn-club" action={dispatch} className={CARD}>
      <h3 className={HEADING}>{t('documents.club.title')}</h3>
      <input type="hidden" name="studentId" value={studentId} />
      <p className="text-sm text-foreground-muted">{t('documents.club.hint')}</p>
      <div className="flex flex-wrap gap-4">
        <TextField
          name="association"
          label={t('documents.club.association')}
          initial={club.association ?? ''}
          maxLength={20}
          error={error('association')}
        />
        <TextField
          name="clubCode"
          label={t('documents.club.clubCode')}
          initial={club.clubCode ?? ''}
          maxLength={20}
          error={error('clubCode')}
        />
      </div>
      <div>
        <button type="submit" disabled={isPending} className={PRIMARY}>
          {isPending ? t('common.working') : t('common.save')}
        </button>
      </div>
    </form>
  );
}

/**
 * *Identificação* — the ID document's photograph and its details, together
 * (Rui, 30-10-2026). The photo is chosen or dropped anywhere on the page; it is
 * filed on the student and, when the reader is on, its number and dates are
 * proposed in the form below for a person to confirm and save.
 */
export function IdentificationSection({
  studentId,
  idDocument,
  photo,
  storageReady,
  fullNumber = null,
}: {
  studentId: string;
  idDocument: StudentDocuments['idDocument'];
  fullNumber?: string | null;
  photo: { fileId: string; filedAt: string } | null;
  storageReady: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const input = useRef<HTMLInputElement>(null);
  const [state, dispatch, pending] = useSavedAction(uploadIdPhotoAction, { ok: false } as IdPhotoState);

  const send = useCallback(
    (file: File): void => {
      if (!storageReady) return;
      const data = new FormData();
      data.set('studentId', studentId);
      data.set('file', file);
      startTransition(() => dispatch(data));
    },
    [dispatch, storageReady, studentId],
  );
  const { dragging } = useFileDrop(send);

  return (
    <>
      <DropOverlay shown={dragging && storageReady} label={t('documents.idPhoto.drop')} />
      <section className={CARD}>
        <h3 className={HEADING}>{t('documents.idPhoto.title')}</h3>
        <p className="text-sm text-foreground-muted">{t('documents.idPhoto.intro')}</p>
        {photo !== null && (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <DocumentLink fileId={photo.fileId} fileName={t('documents.idPhoto.current')} />
            <span className="text-foreground-muted">{t('documents.idPhoto.filedOn', { date: formatDate(photo.filedAt) })}</span>
          </p>
        )}
        <div className="flex flex-col items-start gap-1">
          <button
            type="button"
            disabled={!storageReady || pending}
            onClick={() => input.current?.click()}
            className="inline-flex h-control items-center justify-center gap-2 rounded border border-border bg-surface px-4 text-control hover:bg-surface-muted disabled:opacity-60"
          >
            <Camera className="size-4" aria-hidden />
            {pending ? t('documents.idPhoto.reading') : photo === null ? t('documents.idPhoto.upload') : t('documents.idPhoto.replace')}
          </button>
          <input
            ref={input}
            type="file"
            className="hidden"
            accept={acceptFor('student_document')}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) send(file);
              event.target.value = '';
            }}
          />
          <span className="text-sm text-foreground-muted">
            {storageReady ? t('documents.idPhoto.hint') : t('files.notConfigured')}
          </span>
          {state.readNote !== undefined && (
            <span className="text-sm text-foreground-muted">{t(`documents.idPhoto.note.${state.readNote}`)}</span>
          )}
        </div>
      </section>
      <IdDocumentForm
        studentId={studentId}
        idDocument={idDocument}
        proposal={state.proposal ?? null}
        fullNumber={fullNumber}
      />
    </>
  );
}
