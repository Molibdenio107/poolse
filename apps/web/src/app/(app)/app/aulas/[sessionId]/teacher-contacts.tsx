import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ChevronRight, Phone } from 'lucide-react';
import { apiFetch, type LessonContact } from '@/lib/api';
import { outcome } from '@/lib/load-failure';
import { photoUrlFor } from '@/lib/photo';
import { LinkBusy } from '@/components/link-busy';
import { PersonAvatar } from '@/components/person-avatar';

/** One number, as the student's record draws it: the words, then a button that dials. */
function Call({
  name,
  detail,
  phone,
  t,
}: {
  name: string;
  detail: string | null;
  phone: string;
  t: Awaited<ReturnType<typeof getTranslations>>;
}): React.ReactElement {
  return (
    <li className="flex flex-col gap-2 py-2">
      <div className="min-w-0">
        <p className="font-medium">{name}</p>
        {detail !== null && <p className="text-sm text-foreground-muted">{detail}</p>}
      </div>
      <a
        href={`tel:${phone.replace(/[^\d+]/g, '')}`}
        aria-label={t('students.callName', { name, phone })}
        className="inline-flex h-control items-center justify-center gap-1.5 rounded-sm border border-primary/40 px-4 text-control font-medium text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
      >
        <Phone className="size-4" aria-hidden />
        {phone}
      </a>
    </li>
  );
}

/** Insurance first, then everybody with a number, each a button that dials. */
export function ContactPeople({
  contact,
  studentName,
  t,
}: {
  contact: LessonContact;
  studentName: string;
  t: Awaited<ReturnType<typeof getTranslations>>;
}): React.ReactElement {
  return (
    <>
      <p className="text-sm font-medium">{t(`students.table.insurance.${contact.insurance}`)}</p>
      {contact.people.length === 0 ? (
        <p className="text-sm text-foreground-muted">{t('app.teaching.contactNone')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {contact.people.map((person) => (
            <Call
              key={`${person.kind}-${person.phone}`}
              name={person.kind === 'self' ? studentName : person.name}
              detail={
                person.kind === 'self'
                  ? t('students.contactSelf')
                  : person.kind === 'emergency'
                    ? [t('app.teaching.contactEmergency'), person.relationship].filter(Boolean).join(' · ')
                    : [person.relationship, person.primary ? t('students.guardianPrimary') : null]
                        .filter(Boolean)
                        .join(' · ') || null
              }
              phone={person.phone}
              t={t}
            />
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * Who to call about a child at the pool (Rui, 07-11-2026). A teacher has no back
 * office on a phone, so the number lives on the lesson. One student at a time: a
 * tap asks the API for that child, so a roll of fifteen does not put fifteen
 * families' phones on the screen, and each one read is on the record.
 */
export async function TeacherContacts({
  sessionId,
  entries,
  chosen,
  hrefFor,
}: {
  sessionId: string;
  entries: readonly { studentId: string; shortName: string; photoFileId?: string | null }[];
  chosen: string | undefined;
  hrefFor: (studentId: string) => string;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const open = entries.some((entry) => entry.studentId === chosen) ? chosen : undefined;
  const contact =
    open === undefined ? null : await outcome(apiFetch<LessonContact>(`/sessions/${sessionId}/contacts/${open}`));

  return (
    <section className="flex flex-col">
      <h2 className="app-section-label">{t('app.teaching.sectionContacts')}</h2>
      <ul className="flex flex-col divide-y divide-border">
        {entries.map((entry) => (
          <li key={entry.studentId}>
            <Link
              href={hrefFor(entry.studentId)}
              scroll={false}
              aria-expanded={entry.studentId === open}
              className="flex min-h-[52px] items-center gap-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <PersonAvatar
                id={entry.studentId}
                name={entry.shortName}
                photoUrl={photoUrlFor(entry.photoFileId ?? null)}
                size="sm"
              />
              <span className="min-w-0 flex-1 truncate">{entry.shortName}</span>
              <ChevronRight className="size-4 shrink-0 text-foreground-muted" aria-hidden />
              <LinkBusy />
            </Link>

            {entry.studentId === open && contact !== null && (
              <div className="flex flex-col gap-1 pb-3">
                {contact.state !== 'ok' ? (
                  <p className="text-sm text-foreground-muted">{t('app.teaching.contactFailed')}</p>
                ) : (
                  <ContactPeople contact={contact.data} studentName={entry.shortName} t={t} />
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
