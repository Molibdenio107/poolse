import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft, Ban } from 'lucide-react';
import { ApiError, apiFetch, type Me, type Register } from '@/lib/api';
import { backTarget } from '@/lib/back';
import { formatDate } from '@/lib/date-format';
import { describeLoad, outcome } from '@/lib/load-failure';
import { moduleIsOn } from '@/lib/modules';
import { photoUrlFor } from '@/lib/photo';
import { FeedbackList } from '@/components/feedback-list';
import { LinkBusy } from '@/components/link-busy';
import { PageError } from '@/components/page-shell';
import { PersonAvatar } from '@/components/person-avatar';
import { SectionPills } from '@/components/section-pills';
import type { LessonPlan } from '@/app/(app)/dashboard/calendar/lesson-plan.actions';
import { RegisterForm } from '@/app/(app)/dashboard/calendar/sessions/[sessionId]/register-form';
import { LessonActions } from './lesson-actions';
import { TeacherContacts } from './teacher-contacts';
import { TeacherMessage } from './teacher-message';
import { TeacherPlan } from './teacher-plan';

type LessonRegister = Register & {
  organizationId: string;
  canRecord: boolean;
  canCancel: boolean;
  canRequestCover: boolean;
  coverRequest: { note: string | null } | null;
};

/**
 * One lesson, on the teacher's phone — POOLSE-197. Who is in it, who said they are
 * coming, the register and the plan on one screen, through the routes the desktop
 * already uses. The in-depth work stays there (Rui, 07-11-2026): this is the
 * poolside.
 */
export default async function TeachingLesson({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ from?: string; section?: string; student?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { sessionId } = await params;
  const { from, section, student } = await searchParams;
  const back = backTarget(from, '/app/aulas/calendario');

  let register: LessonRegister;
  try {
    register = await apiFetch<LessonRegister>(`/sessions/${sessionId}/attendance`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    const failure = describeLoad(error);
    return <PageError message={t(failure.key)} {...(failure.detail === '' ? {} : { detail: failure.detail })} />;
  }

  // The phone is the reader's own lessons. A colleague's register stays a desktop read.
  if (!register.canRecord) notFound();

  const plan = await outcome(apiFetch<LessonPlan>(`/sessions/${sessionId}/plan`));
  const notices = new Map((register.notices ?? []).map((one) => [one.studentId, one.going]));
  const cancelled = register.status === 'cancelled';

  // One section at a time: fifteen students would bury the plan under the roll.
  const showPlan = section === 'plano' && plan.state === 'ok' && !cancelled;
  // POOLSE-199: a parceria has no families here, and the module may be off.
  const classGroupId = register.classGroupId;
  const mayWrite = !cancelled && register.canRecord && classGroupId !== null && (await moduleIsOn('messages'));
  const showMessage = section === 'mensagem' && mayWrite;
  // Who to call (Rui, 07-11-2026). The API refuses a view, so a view is not offered it.
  const mayCall = !cancelled && (await apiFetch<Me>('/me')).viewing == null;
  const showContacts = section === 'contactos' && mayCall;
  const onRoll = !showPlan && !showMessage && !showContacts;
  const hrefFor = (key: string, chosen?: string): string => {
    const query = new URLSearchParams();
    if (key !== 'alunos') query.set('section', key);
    if (chosen !== undefined) query.set('student', chosen);
    if (from !== undefined) query.set('from', from);
    return `/app/aulas/${sessionId}${query.size === 0 ? '' : `?${query.toString()}`}`;
  };

  return (
    <>
      <Link
        href={back.href}
        aria-label={t(back.labelKey)}
        className="inline-flex items-center gap-1.5 self-start text-sm text-primary hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('common.back')}
        <LinkBusy />
      </Link>

      <header className="flex flex-col gap-0.5">
        <h1 className="text-xl font-semibold tracking-tight">{register.className}</h1>
        <p className="text-sm text-foreground-muted">
          {[formatDate(register.localDate), register.localTime, register.poolName].filter(Boolean).join(' · ')}
        </p>
      </header>

      {cancelled && (
        <p className="flex items-center gap-1.5 text-sm font-medium text-danger">
          <Ban className="size-4 shrink-0" aria-hidden />
          {t('app.family.cancelled')}
        </p>
      )}

      {!cancelled && register.canRecord && (
        <LessonActions
          part="cover"
          sessionId={register.sessionId}
          request={register.coverRequest}
          canRequest={register.canRequestCover}
          canCancel={register.canCancel}
        />
      )}

      {plan.state === 'ok' && !cancelled && (
        <SectionPills
          label={t('app.teaching.sectionsLabel')}
          current={showPlan ? 'plano' : showMessage ? 'mensagem' : showContacts ? 'contactos' : 'alunos'}
          items={[
            { key: 'alunos', label: t('app.teaching.sectionStudents'), href: hrefFor('alunos') },
            { key: 'plano', label: t('app.teaching.sectionPlan'), href: hrefFor('plano') },
            ...(mayWrite
              ? [{ key: 'mensagem', label: t('app.teaching.sectionMessage'), href: hrefFor('mensagem') }]
              : []),
            ...(mayCall
              ? [{ key: 'contactos', label: t('app.teaching.sectionContacts'), href: hrefFor('contactos') }]
              : []),
          ]}
        />
      )}

      {showPlan && plan.state === 'ok' ? (
        <TeacherPlan plan={plan.data} />
      ) : showMessage ? (
        <TeacherMessage classGroupId={classGroupId} />
      ) : showContacts ? (
        <TeacherContacts
          sessionId={register.sessionId}
          entries={register.entries}
          chosen={student}
          hrefFor={(id) => hrefFor('contactos', id === student ? undefined : id)}
        />
      ) : register.started && register.canRecord && !cancelled ? (
        <RegisterForm register={register} compact />
      ) : (
        <section className="flex flex-col">
          <h2 className="app-section-label">
            {t('app.teaching.enrolled', { enrolled: register.entries.length })}
          </h2>
          <ul className="flex flex-col divide-y divide-border">
            {register.entries.map((entry) => {
              const going = notices.get(entry.studentId);
              return (
                <li key={entry.studentId} className="flex min-h-[52px] items-center gap-3 py-2">
                  <PersonAvatar
                    id={entry.studentId}
                    name={entry.shortName}
                    photoUrl={photoUrlFor(entry.photoFileId ?? null)}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1 truncate">{entry.shortName}</span>
                  {going !== undefined && (
                    <span className="rounded border border-border px-2 py-0.5 text-xs text-foreground-muted">
                      {t(going ? 'app.teaching.going' : 'app.teaching.notGoing')}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {onRoll && !cancelled && register.canRecord && (
        <LessonActions
          part="cancel"
          sessionId={register.sessionId}
          request={register.coverRequest}
          canRequest={register.canRequestCover}
          canCancel={register.canCancel}
        />
      )}

      {onRoll && (register.feedback ?? []).length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="app-section-label">{t('feedback.tab')}</h2>
          <FeedbackList items={register.feedback ?? []} by="student" canArchive={false} />
        </section>
      )}
    </>
  );
}
