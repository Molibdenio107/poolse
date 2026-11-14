'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Combine } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { mergeTurmasAction } from './classes.actions';

const PRIMARY =
  'inline-flex h-control items-center justify-center gap-2 rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const QUIET =
  'inline-flex h-control items-center justify-center gap-2 rounded-sm bg-surface px-4 text-control shadow-card hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const INPUT =
  'h-control w-full rounded-sm border border-border-strong bg-background px-2.5 text-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export interface JoinableTurma {
  id: string;
  name: string;
  /** "Seg 07:00 · Qui 19:00", or the words for none. */
  schedule: string;
  students: number;
}

/**
 * *Juntar turmas* — Rui, 14-11-2026. Owner and admin, from a folded set on
 * Lista. The office ticks the turmas that are really the same students, picks
 * the one that stays (its teacher, level and capacity are kept) and its name;
 * everything else moves into it and the rest are archived. It asks first, and
 * says it does not come undone.
 */
export function JoinTurmas({ turmas, baseName }: { turmas: JoinableTurma[]; baseName: string }): React.ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const { show } = useToast();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [keep, setKeep] = useState<string>('');
  const [name, setName] = useState(baseName);
  const [working, setWorking] = useState(false);

  const start = (): void => {
    setChosen(new Set());
    setKeep('');
    setName(baseName);
    setOpen(true);
  };
  const toggle = (id: string, on: boolean): void => {
    setChosen((was) => {
      const next = new Set(was);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
    if (on && keep === '') setKeep(id);
    if (!on && keep === id) setKeep([...chosen].find((other) => other !== id) ?? '');
  };

  const target = chosen.has(keep) ? keep : '';
  const from = [...chosen].filter((id) => id !== target);
  const ready = target !== '' && from.length > 0 && name.trim() !== '';

  const join = async (): Promise<void> => {
    setWorking(true);
    const done = await mergeTurmasAction(target, from, name.trim());
    setWorking(false);
    if (done.ok) {
      show('success', t('classes.cards.join.done', { turmas: done.turmas + 1, name: name.trim() }));
      setOpen(false);
      router.refresh();
      return;
    }
    const known = ['merge_same_hour', 'merge_over_capacity', 'merge_name_taken', 'merge_other_season', 'enrollment_clash'];
    const key = known.includes(done.code) ? done.code : 'merge_failed';
    show(
      'danger',
      t(`classes.cards.join.refused.${key}`, {
        capacity: done.capacity ?? 0,
        students: done.students ?? 0,
        day: done.weekday === undefined ? '' : t(`weekShort.${done.weekday}`),
        time: done.startTime ?? '',
      }),
    );
  };

  return (
    <>
      <button type="button" className={QUIET} onClick={start}>
        <Combine aria-hidden className="size-4" />
        {t('classes.cards.join.open')}
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('classes.cards.join.title', { name: baseName })}
        closeLabel={t('common.close')}
        className="max-w-xl"
      >
        <div className="flex flex-col gap-4 text-sm">
          <p>{t('classes.cards.join.explain')}</p>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-medium">{t('classes.cards.join.which')}</legend>
            {turmas.map((turma) => (
              <div key={turma.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border p-2">
                <label className="flex min-w-0 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={chosen.has(turma.id)}
                    onChange={(event) => toggle(turma.id, event.target.checked)}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">{turma.name}</span>
                    <span className="text-xs text-foreground-muted">
                      {turma.schedule} · {t('classes.cards.join.students', { count: turma.students })}
                    </span>
                  </span>
                </label>
                {chosen.has(turma.id) && (
                  <label className="flex items-center gap-1.5 text-xs">
                    <input
                      type="radio"
                      name="join-keep"
                      checked={target === turma.id}
                      onChange={() => setKeep(turma.id)}
                    />
                    {t('classes.cards.join.keep')}
                  </label>
                )}
              </div>
            ))}
          </fieldset>
          <label className="flex flex-col gap-1">
            <span className="font-medium">{t('classes.cards.join.name')}</span>
            <input className={INPUT} value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
          </label>
          <p className="text-foreground-muted">{t('classes.cards.join.final')}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={PRIMARY} disabled={!ready || working} onClick={() => void join()}>
              {t('classes.cards.join.confirm', { count: chosen.size })}
            </button>
            <button type="button" className={QUIET} onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
