'use client';

import { useTranslations } from 'next-intl';
import { useImportPreview } from '@/lib/import-preview';

/**
 * The turmas an import waiting for *Confirmar* would create — POOLSE-224, rule 4.
 *
 * Beside the club's real turmas, marked *nova (por confirmar)* in words, with
 * their days and times. Not links: they do not exist yet, so there is nothing to
 * open or edit until the import is confirmed.
 */
export function PendingTurmas(): React.ReactElement | null {
  const t = useTranslations();
  const preview = useImportPreview();
  if (preview === null || preview.done !== undefined) return null;

  const kept = preview.rows.filter((row) => row.importable && !preview.drop.includes(row.index));
  const fresh = preview.turmas
    .filter((turma) => turma.existingId === null)
    .map((turma) => ({
      ...turma,
      slots: kept
        .filter((row) => row.turmaKey === turma.key)
        .sort((a, b) => a.weekday - b.weekday || a.startMinutes - b.startMinutes),
    }))
    .filter((turma) => turma.slots.length > 0);
  if (fresh.length === 0) return null;

  const clock = (minutes: number): string =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

  return (
    <section aria-labelledby="pending-turmas" className="rounded-card border border-dashed border-primary bg-primary/5 p-4">
      <h2 id="pending-turmas" className="mb-2 text-sm font-semibold">
        {t('importPreview.pendingTitle')}
      </h2>
      <ul className="flex flex-col gap-1.5 text-sm">
        {fresh.map((turma) => (
          <li key={turma.key} className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{turma.name}</span>
            <span className="text-primary">{t('importPreview.newTurma')}</span>
            <span className="text-foreground-muted">
              {turma.slots.map((slot) => `${t(`week.${slot.weekday}` as never)} ${clock(slot.startMinutes)}`).join(', ')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
