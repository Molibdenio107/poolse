import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { formatSwimTime } from '@poolse/rules';
import { ApiError, apiFetch, type TeachingStudentCard } from '@/lib/api';
import type { Invitee } from '@/app/(app)/dashboard/students/[id]/family-access';
import { ageInYears } from '@/lib/ages';
import { describeLoad, outcome } from '@/lib/load-failure';
import { photoUrlFor } from '@/lib/photo';
import { LinkBusy } from '@/components/link-busy';
import { PageError } from '@/components/page-shell';
import { PersonAvatar } from '@/components/person-avatar';
import { ContactPeople } from '../../aulas/[sessionId]/teacher-contacts';
import { FamilyInvite } from './family-invite';

/**
 * One student, on the teacher's phone (Rui, 07-11-2026): simple and informative.
 * Age, level, turmas, favourite stroke, the best time per event, and who to call.
 * The full record stays on the desktop. Opening it is on the record, for the numbers.
 */
export default async function TeachingStudentPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { studentId } = await params;

  let card: TeachingStudentCard;
  try {
    card = await apiFetch<TeachingStudentCard>(`/app/teaching/students/${studentId}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    const failure = describeLoad(error);
    return <PageError message={t(failure.key)} {...(failure.detail === '' ? {} : { detail: failure.detail })} />;
  }

  // The family's way into the app, when the API lets this teacher invite (their own turmas).
  const access = await outcome(
    apiFetch<{ organizationName: string; canInvite: boolean; invitees: Invitee[] }>(`/students/${studentId}/invitations`),
  );
  const age = card.birthDate === null ? null : ageInYears(card.birthDate);
  const facts: [string, string][] = [
    [t('app.teaching.studentAge'), age === null ? '—' : t('app.teaching.studentYears', { age })],
    [t('app.teaching.studentLevel'), card.levelName ?? '—'],
    [t('app.teaching.studentTurmas'), card.turmas.join(' · ')],
    [
      t('app.teaching.studentFavourite'),
      card.favouriteStroke === null ? '—' : t(`progress.strokes.${card.favouriteStroke}` as never),
    ],
  ];

  return (
    <>
      <Link
        href="/app/alunos"
        aria-label={t('app.teaching.backToStudents')}
        className="inline-flex items-center gap-1.5 self-start text-sm text-primary hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('common.back')}
        <LinkBusy />
      </Link>

      <section className="flex flex-col items-center gap-3 rounded bg-surface p-4 text-center shadow-card">
        <PersonAvatar
          id={card.id}
          name={card.name}
          photoUrl={photoUrlFor(card.photoFileId)}
          className="size-20 text-xl"
        />
        <h1 className="text-lg font-bold">{card.name}</h1>
        <dl className="flex w-full flex-col divide-y divide-border text-left">
          {facts.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-3 py-2">
              <dt className="text-sm text-foreground-muted">{label}</dt>
              <dd className="text-right">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex flex-col">
        <h2 className="app-section-label">{t('app.teaching.studentBests')}</h2>
        {card.bests.length === 0 ? (
          <p className="text-sm text-foreground-muted">{t('app.teaching.studentNoBests')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {card.bests.map((best) => (
              <li
                key={`${best.stroke}-${best.distanceM}`}
                className="flex min-h-[44px] items-center justify-between gap-3 py-2"
              >
                <span>
                  {t('app.records.event', {
                    distance: best.distanceM,
                    stroke: t(`progress.strokes.${best.stroke}` as never),
                  })}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{formatSwimTime(best.timeMs)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-1">
        <h2 className="app-section-label">{t('app.teaching.sectionContacts')}</h2>
        <ContactPeople contact={card.contact} studentName={card.name} t={t} />
      </section>

      {access.state === 'ok' && access.data.canInvite && (
        <FamilyInvite
          studentId={card.id}
          studentFirstName={card.name.split(' ')[0] ?? card.name}
          organizationName={access.data.organizationName}
          invitees={access.data.invitees}
        />
      )}
    </>
  );
}
