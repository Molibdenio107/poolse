import { getTranslations } from 'next-intl/server';
import { Check, Users } from 'lucide-react';
import { PersonAvatar } from '@/components/person-avatar';
import { PhotoZoom } from '@/components/app/photo-zoom';
import type { AppClassmates } from '@/lib/api';
import { photoUrlFor } from '@/lib/photo';

/** How many people *Início* shows before *Ver todos*. */
const VISIBLE = 4;

/**
 * Who teaches, and who is in the class — POOLSE-194 (Rui, 06-11-2026). A minor who
 * is not the reader's own has no name and no photo, and the API sends neither, so
 * they are a count on one line. *Não vou* is a number: nobody is named under it. Each state is in
 * words as well as its mark. A photo opens large; initials do not.
 */
export async function Classmates({
  data,
  collapse = false,
}: {
  data: AppClassmates;
  /** *Início* (Rui, 06-11-2026): past four people, the rest wait behind *Ver todos*. */
  collapse?: boolean;
}): Promise<React.ReactElement | null> {
  const t = await getTranslations();
  const avatar = (key: string, name: string, url: string | null): React.ReactElement =>
    url === null ? (
      <PersonAvatar id={key} name={name} size="sm" />
    ) : (
      <PhotoZoom src={url} name={name} label={t('app.classmates.seePhoto', { name })} className="size-7 coarse:size-9" />
    );
  if (data.instructor === null && data.enrolled === null) return null;
  const named = data.people;
  const { count: hiddenCount, going: goingHidden, done: doneHidden } = data.hidden;
  const row = (person: AppClassmates['people'][number], index: number): React.ReactElement => {
    const name = person.name;
    return (
      <li key={index} className="flex min-h-9 items-center gap-2 text-sm">
        {avatar(`classmate-${index}`, name, photoUrlFor(person.photoFileId))}
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {/* POOLSE-195: their own word on the Desafio, never a grade. */}
        {person.challengeDone !== null ? (
          <span className="font-medium">
            {t(person.challengeDone ? 'app.feedback.challengeDone' : 'app.feedback.challengeNotDone')}
          </span>
        ) : person.going === true ? (
          <span className="flex items-center gap-1 font-medium text-success">
            <Check className="size-3.5" aria-hidden />
            {t('app.classmates.going')}
          </span>
        ) : (
          <span className="text-foreground-muted">{t('app.classmates.enrolled')}</span>
        )}
      </li>
    );
  };
  return (
    <section className="flex flex-col gap-2 bg-surface p-4">
      {data.instructor !== null && (
        <p className="flex items-center gap-2 text-sm">
          {avatar('instructor', data.instructor.name, data.instructor.photoUrl)}
          <span>
            {data.instructor.standIn
              ? t('app.family.standIn', { name: data.instructor.name })
              : t('app.classmates.instructor', { name: data.instructor.name })}
          </span>
        </p>
      )}
      {data.enrolled !== null && (
        <>
          <p className="flex items-center gap-1.5 text-sm text-foreground-muted">
            <Users className="size-4 shrink-0" aria-hidden />
            {t('app.family.hero.count', { enrolled: data.enrolled, notComing: data.notComing })}
          </p>
          {collapse && named.length > VISIBLE ? (
            <>
              <ul className="flex flex-col gap-1">{named.slice(0, VISIBLE).map(row)}</ul>
              <details>
                <summary className="flex min-h-control cursor-pointer items-center text-sm font-medium text-primary">
                  {t('app.classmates.seeAll', { count: named.length })}
                </summary>
                <ul className="flex flex-col gap-1">{named.slice(VISIBLE).map(row)}</ul>
              </details>
            </>
          ) : (
            named.length > 0 && <ul className="flex flex-col gap-1">{named.map(row)}</ul>
          )}
          {/* One line, however many: a roll of nameless rows says nothing a phone has room for. */}
          {hiddenCount > 0 && (
            <p className="text-sm text-foreground-muted">
              {t(named.length > 0 ? 'app.classmates.others' : 'app.classmates.all', { count: hiddenCount })}
              {goingHidden !== null && goingHidden > 0 && ` · ${t('app.classmates.othersGoing', { count: goingHidden })}`}
              {doneHidden !== null && doneHidden > 0 && ` · ${t('app.classmates.othersDone', { count: doneHidden })}`}
            </p>
          )}
        </>
      )}
    </section>
  );
}
