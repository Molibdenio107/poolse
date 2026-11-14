'use client';

import { useTranslations } from 'next-intl';

interface Turma {
  nameKey: string;
  name: string;
  atSeveralHours: boolean;
  whole: boolean;
  slots: number[];
}

/**
 * A class that runs at several hours — Rui, 14-11-2026.
 *
 * A turma is a group of students, and a timetable says nothing about who is in
 * each class, so the import cannot know whether *Hidroginástica* at 07:00 and at
 * 19:00 is one group or two. It asks, once per class name: one turma per hour
 * (the default, the masters case: different people at different hours) or one
 * turma with every hour. Changing it checks the file again; nothing is written.
 */
export function SeveralHours({
  turmas,
  whole,
  working,
  onChange,
}: {
  turmas: Turma[];
  whole: string[];
  working: boolean;
  onChange: (next: string[]) => void;
}): React.ReactElement | null {
  const t = useTranslations();

  const names = new Map<string, { name: string; turmas: number; slots: number }>();
  for (const turma of turmas) {
    if (!turma.atSeveralHours) continue;
    const was = names.get(turma.nameKey);
    // A per-hour turma is named "Nome · HH:MM"; the class's own name is before it.
    const name = turma.whole ? turma.name : turma.name.replace(/\s·\s\d{1,2}:\d{2}.*$/, '');
    names.set(turma.nameKey, {
      name: was?.name ?? name,
      turmas: (was?.turmas ?? 0) + 1,
      slots: (was?.slots ?? 0) + turma.slots.length,
    });
  }
  if (names.size === 0) return null;

  const set = (nameKey: string, one: boolean): void => {
    const next = new Set(whole);
    if (one) next.add(nameKey);
    else next.delete(nameKey);
    onChange([...next]);
  };

  return (
    <section className="flex flex-col gap-3 rounded border border-border p-4">
      <h3 className="text-sm font-semibold">{t('timetableImport.severalHours.title')}</h3>
      <p className="text-sm text-foreground-muted">{t('timetableImport.severalHours.explain')}</p>
      <ul className="flex flex-col gap-3">
        {[...names.entries()].map(([nameKey, info]) => {
          const one = whole.includes(nameKey);
          return (
            <li key={nameKey}>
              <fieldset className="flex flex-col gap-1 text-sm" disabled={working}>
                <legend className="font-medium">
                  {t('timetableImport.severalHours.name', { name: info.name, slots: info.slots })}
                </legend>
                <label className="flex items-center gap-2">
                  <input type="radio" name={`whole-${nameKey}`} checked={!one} onChange={() => set(nameKey, false)} />
                  {t('timetableImport.severalHours.perHour')}
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name={`whole-${nameKey}`} checked={one} onChange={() => set(nameKey, true)} />
                  {t('timetableImport.severalHours.one')}
                </label>
              </fieldset>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
