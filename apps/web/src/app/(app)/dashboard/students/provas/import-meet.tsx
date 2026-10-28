'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Upload } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { DropOverlay, useFileDrop } from '@/components/file-drop';
import { SelectField } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { formatTime } from '@/components/progress-chart';
import { formatDate } from '@/lib/date-format';
import type { MeetImportPreview, MeetSkipReason } from '@/lib/api';
import type { LenexClub } from '@poolse/rules/lenex';
import { importMeetAction, readMeetFileAction } from './meets.actions';

const BUTTON =
  'inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded bg-primary text-primary-foreground disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const BUTTON_QUIET =
  'inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded border border-border hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const SKIPS: MeetSkipReason[] = ['relay', 'dsq', 'dns', 'dnf', 'wdr', 'otherStatus', 'noTime', 'yards', 'stroke'];

/** What the dialog reads: a file dropped or chosen here, or one that arrived by email (POOLSE-114). */
export type ImportSource =
  | { kind: 'file'; file: File }
  | { kind: 'inbox'; inboxId: string; fileName: string };

function appendSource(data: FormData, source: ImportSource): void {
  if (source.kind === 'file') data.set('file', source.file);
  else data.set('inboxId', source.inboxId);
}

/**
 * Importar resultados — POOLSE-81.
 *
 * The button and the page-wide drop. A dropped or chosen file opens
 * `MeetImportDialog`; `help` sits under the format line — POOLSE-114's
 * *Como obter os resultados*.
 */
export function ImportMeet({
  organizationId,
  rememberedClubCode,
  help,
}: {
  organizationId: string;
  rememberedClubCode: string | null;
  help?: React.ReactNode;
}): React.ReactElement {
  const t = useTranslations();
  const input = useRef<HTMLInputElement | null>(null);
  const [source, setSource] = useState<ImportSource | null>(null);
  const take = useCallback((dropped: File) => setSource({ kind: 'file', file: dropped }), []);
  const { dragging } = useFileDrop(take);

  return (
    <>
      <DropOverlay shown={dragging} label={t('meets.import.drop')} />
      <div className="flex flex-col gap-1">
        <div>
          <button type="button" className={BUTTON} onClick={() => input.current?.click()} aria-describedby="meet-import-format">
            <Upload className="size-4" aria-hidden />
            {t('meets.import.button')}
          </button>
        </div>
        {/*
          What the import reads, in one line, and how to get the file —
          POOLSE-111, with POOLSE-114's explanation under it. LENEX alone (Rui,
          22-10-2026): it is the one format that carries the licence, the event,
          the course and the exact time in a shape a swimmer can be matched by.
        */}
        <p id="meet-import-format" className="max-w-xs text-sm text-foreground-muted">
          {t('meets.import.formatHint')}
        </p>
        {help}
      </div>
      <input
        ref={input}
        type="file"
        accept=".lef,.lxf"
        className="sr-only"
        aria-label={t('meets.import.button')}
        onChange={(event) => {
          const chosen = event.target.files?.[0];
          event.target.value = '';
          if (chosen) setSource({ kind: 'file', file: chosen });
        }}
      />
      <MeetImportDialog
        source={source}
        onClose={() => setSource(null)}
        organizationId={organizationId}
        rememberedClubCode={rememberedClubCode}
      />
    </>
  );
}

/** *Importar* on a row of *Recebidos por email* — the same dialog, the file already loaded (POOLSE-114). */
export function ImportFromInbox({
  organizationId,
  rememberedClubCode,
  inboxId,
  fileName,
  label,
}: {
  organizationId: string;
  rememberedClubCode: string | null;
  inboxId: string;
  fileName: string;
  /** The row's own name for the button, so a list of *Importar* says which. */
  label: string;
}): React.ReactElement {
  const t = useTranslations();
  const [source, setSource] = useState<ImportSource | null>(null);
  return (
    <>
      <button
        type="button"
        className={BUTTON}
        aria-label={label}
        onClick={() => setSource({ kind: 'inbox', inboxId, fileName })}
      >
        {t('meetInbox.import')}
      </button>
      <MeetImportDialog
        source={source}
        onClose={() => setSource(null)}
        organizationId={organizationId}
        rememberedClubCode={rememberedClubCode}
      />
    </>
  );
}

/**
 * The import's three steps in one dialog — POOLSE-81: the file (read on the
 * server), the club that is this one (pre-selected from the last import), and
 * the preview — matched swimmers, proposals to confirm, what is new, corrected,
 * skipped and unmatched — before one press writes all of it or none. Open while
 * `source` is set; a new source starts again from the top.
 */
function MeetImportDialog({
  source,
  onClose,
  organizationId,
  rememberedClubCode,
}: {
  source: ImportSource | null;
  onClose: () => void;
  organizationId: string;
  rememberedClubCode: string | null;
}): React.ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const { show } = useToast();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meet, setMeet] = useState<{ name: string; startsOn: string | null } | null>(null);
  const [fileName, setFileName] = useState('');
  const [clubs, setClubs] = useState<LenexClub[]>([]);
  const [clubCode, setClubCode] = useState('');
  const [official, setOfficial] = useState(true);
  const [preview, setPreview] = useState<MeetImportPreview | null>(null);
  const [confirmed, setConfirmed] = useState<Record<string, string>>({});
  const [writeLicence, setWriteLicence] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setMeet(null);
    setClubs([]);
    setPreview(null);
    setError(null);
    setConfirmed({});
    setWriteLicence({});
    if (source === null) return;
    setFileName(source.kind === 'file' ? source.file.name : source.fileName);

    // A source replaced while this one is still being read must not land late.
    let current = true;
    setBusy(true);
    const data = new FormData();
    appendSource(data, source);
    void readMeetFileAction(data).then((read) => {
      if (!current) return;
      setBusy(false);
      if (!read.ok) {
        setError(read.errorKey);
        return;
      }
      setFileName(read.fileName);
      setMeet({ name: read.meet.name, startsOn: read.meet.startsOn });
      setClubs(read.clubs);
      const remembered = read.clubs.find((club) => club.code === rememberedClubCode);
      setClubCode(remembered?.code ?? (read.clubs.length === 1 ? read.clubs[0]!.code : ''));
    });
    return () => {
      current = false;
    };
  }, [source, rememberedClubCode]);

  async function run(commit: boolean): Promise<void> {
    if (source === null || clubCode === '') return;
    setBusy(true);
    setError(null);
    const data = new FormData();
    appendSource(data, source);
    data.set('organizationId', organizationId);
    data.set('clubCode', clubCode);
    data.set('official', String(official));
    data.set('commit', String(commit));
    data.set('confirmed', JSON.stringify(confirmed));
    data.set('writeLicence', JSON.stringify(writeLicence));
    const outcome = await importMeetAction(data);
    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.errorKey);
      return;
    }
    if (!commit) {
      setPreview(outcome.preview);
      // Proposals start unconfirmed; their licence write starts ticked.
      setWriteLicence(
        Object.fromEntries(
          outcome.preview.athletes.filter((a) => a.canWriteLicence).map((a) => [a.key, true]),
        ),
      );
      return;
    }
    show('success', t('meets.import.done', { count: outcome.preview.totals.new + outcome.preview.totals.update }));
    onClose();
    if (outcome.preview.meetId) router.push(`/dashboard/students/provas/${outcome.preview.meetId}`);
    else router.refresh();
  }

  const proposals = preview?.athletes.filter((a) => a.match === 'proposed') ?? [];
  const matched = preview?.athletes.filter((a) => a.match === 'licence') ?? [];
  const unmatched = preview?.athletes.filter((a) => a.match === 'none' && a.results.length > 0) ?? [];
  const written = [...matched, ...proposals.filter((a) => confirmed[a.key] === a.studentId)];
  const count = (action: 'new' | 'update' | 'unchanged'): number =>
    written.reduce((sum, a) => sum + a.results.filter((r) => r.action === action).length, 0);
  // New bests among what will be written — an unconfirmed proposal's do not count.
  const newBests = written.reduce((sum, a) => sum + a.results.filter((r) => r.newBest).length, 0);
  const skippedTotal = preview === null ? 0 : SKIPS.reduce((sum, reason) => sum + preview.skipped[reason], 0);

  return (
      <Dialog
        open={source !== null}
        onClose={onClose}
        title={meet === null ? t('meets.import.title') : meet.name}
        closeLabel={t('common.close')}
      >
        <div className="flex flex-col gap-4">
          {meet !== null && meet.startsOn !== null && (
            <p className="text-sm text-foreground-muted">
              {formatDate(meet.startsOn)} · {fileName}
            </p>
          )}
          {busy && <p className="text-sm text-foreground-muted">{t('meets.import.reading')}</p>}
          {error !== null && (
            <p className="flex items-start gap-2 text-sm text-danger">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t(error as never)}
            </p>
          )}

          {clubs.length > 0 && preview === null && (
            <>
              <SelectField
                name="club"
                label={t('meets.import.club')}
                hint={t('meets.import.clubHint')}
                initial={clubCode}
                onValueChange={setClubCode}
                options={[
                  { value: '', label: t('meets.import.chooseClub') },
                  ...clubs.map((club) => ({
                    value: club.code,
                    label: t('meets.import.clubOption', { name: club.name, code: club.code, count: club.athletes }),
                  })),
                ]}
                className="max-w-none"
              />
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={official}
                  onChange={(event) => setOfficial(event.target.checked)}
                  className="mt-0.5 size-4"
                />
                <span>
                  <span className="font-medium">{t('meets.import.official')}</span>
                  <span className="block text-foreground-muted">{t('meets.import.officialHint')}</span>
                </span>
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={BUTTON} disabled={busy || clubCode === ''} onClick={() => void run(false)}>
                  {t('meets.import.preview')}
                </button>
              </div>
            </>
          )}

          {preview !== null && (
            <>
              <p className="text-sm">
                {preview.meet.existingMeetId === null ? t('meets.import.newMeet') : t('meets.import.knownMeet')}
              </p>
              <ul className="list-disc pl-5 text-sm">
                <li>{t('meets.import.countNew', { count: count('new') })}</li>
                {count('update') > 0 && <li>{t('meets.import.countUpdate', { count: count('update') })}</li>}
                {count('unchanged') > 0 && (
                  <li>{t('meets.import.countUnchanged', { count: count('unchanged') })}</li>
                )}
                {newBests > 0 && <li>{t('meets.import.countBests', { count: newBests })}</li>}
                {skippedTotal > 0 && (
                  <li>
                    {t('meets.import.skipped', { count: skippedTotal })}:{' '}
                    {SKIPS.filter((reason) => preview.skipped[reason] > 0)
                      .map((reason) => `${t(`meets.skip.${reason}`)} ${preview.skipped[reason]}`)
                      .join(' · ')}
                  </li>
                )}
              </ul>

              {proposals.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium">{t('meets.import.proposals')}</h3>
                  <p className="text-sm text-foreground-muted">{t('meets.import.proposalsHint')}</p>
                  {proposals.map((athlete) => (
                    <div key={athlete.key} className="flex flex-col gap-1 rounded border border-border p-2 text-sm">
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={confirmed[athlete.key] === athlete.studentId}
                          onChange={(event) =>
                            setConfirmed((current) => {
                              const next = { ...current };
                              if (event.target.checked && athlete.studentId) next[athlete.key] = athlete.studentId;
                              else delete next[athlete.key];
                              return next;
                            })
                          }
                          className="mt-0.5 size-4"
                        />
                        <span>
                          {t('meets.import.proposal', {
                            athlete: athlete.name,
                            student: athlete.studentName ?? '',
                            born: athlete.birthDate === null ? '' : formatDate(athlete.birthDate),
                          })}
                        </span>
                      </label>
                      {athlete.canWriteLicence && confirmed[athlete.key] === athlete.studentId && (
                        <label className="ml-6 flex items-start gap-2 text-foreground-muted">
                          <input
                            type="checkbox"
                            checked={writeLicence[athlete.key] !== false}
                            onChange={(event) =>
                              setWriteLicence((current) => ({ ...current, [athlete.key]: event.target.checked }))
                            }
                            className="mt-0.5 size-4"
                          />
                          {t('meets.import.writeLicence', { licence: athlete.licence ?? '' })}
                        </label>
                      )}
                    </div>
                  ))}
                </section>
              )}

              {written.length > 0 && (
                <section className="flex max-h-72 flex-col gap-1 overflow-y-auto text-sm">
                  <h3 className="font-medium">{t('meets.import.results')}</h3>
                  {written.flatMap((athlete) =>
                    athlete.results
                      .filter((result) => result.action !== 'unchanged')
                      .map((result) => (
                        <p key={`${athlete.key}-${result.eventNumber}-${result.round}`}>
                          {athlete.studentName} · {result.distanceM} m {t(`progress.strokes.${result.stroke}`)} ·{' '}
                          <span className="font-mono">{formatTime(result.timeMs)}</span>
                          {result.action === 'update' && result.previousMs !== null &&
                            ` (${t('meets.import.was', { time: formatTime(result.previousMs) })})`}
                          {result.newBest && (
                            <span className="ml-2 rounded bg-success/15 px-2 text-success">
                              {t('progress.personalBest')}
                            </span>
                          )}
                        </p>
                      )),
                  )}
                </section>
              )}

              {unmatched.length > 0 && (
                <p className="text-sm text-warning">
                  {t('meets.import.unmatched', {
                    count: unmatched.length,
                    names: unmatched.map((a) => a.name).join(', '),
                  })}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={BUTTON}
                  disabled={busy || count('new') + count('update') === 0}
                  onClick={() => void run(true)}
                >
                  {t('meets.import.commit', { count: count('new') + count('update') })}
                </button>
                <button type="button" className={BUTTON_QUIET} onClick={() => setPreview(null)}>
                  {t('meets.import.back')}
                </button>
              </div>
            </>
          )}
        </div>
      </Dialog>
  );
}
