import { Mail, Phone } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { Guardian } from '@/lib/api';

/**
 * Who to ring — POOLSE-88 slice 2, tier 1 flow 5.
 *
 * An instructor at the poolside opens a child's page for one reason more than
 * any other: a parent to call. The editing form holds the same numbers in text
 * boxes, which a finger cannot dial, and an instructor sees no form at all — so
 * this card is the record's contacts as links: `tel:` opens the dialer, `mailto:`
 * the mail app. The primary contact first, because that is who is rung first.
 *
 * Read-only by construction: it is a summary of what the form below edits, never
 * a second place to change it.
 */
export async function ContactsCard({
  guardians,
  studentName,
  studentPhone,
  studentEmail,
}: {
  guardians: Guardian[];
  studentName: string;
  studentPhone: string | null;
  studentEmail: string | null;
}): Promise<React.ReactElement | null> {
  const t = await getTranslations();

  const people = [
    ...[...guardians]
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
      .map((guardian) => ({
        key: guardian.linkId,
        name: guardian.name,
        detail: [guardian.relationship, guardian.isPrimary ? t('students.guardianPrimary') : null]
          .filter(Boolean)
          .join(' · '),
        phone: guardian.phone,
        email: guardian.email,
      })),
    // The student's own contacts — an adult's, or a teenager's mobile.
    ...(studentPhone === null && studentEmail === null
      ? []
      : [{ key: 'self', name: studentName, detail: t('students.contactSelf'), phone: studentPhone, email: studentEmail }]),
  ].filter((person) => person.phone !== null || person.email !== null);

  if (people.length === 0) return null;

  return (
    <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
      <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
        {t('students.contactsTitle')}
      </h2>
      <ul className="flex flex-col divide-y divide-border">
        {people.map((person) => (
          <li key={person.key} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-medium">{person.name}</p>
              {person.detail !== '' && <p className="text-sm text-foreground-muted">{person.detail}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {person.phone !== null && (
                <a
                  href={`tel:${person.phone.replace(/[^\d+]/g, '')}`}
                  aria-label={t('students.callName', { name: person.name, phone: person.phone })}
                  className="inline-flex h-control items-center justify-center px-4 text-control gap-1.5 rounded border border-primary/40 font-medium text-primary hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                >
                  <Phone className="size-4" aria-hidden />
                  {person.phone}
                </a>
              )}
              {person.email !== null && (
                <a
                  href={`mailto:${person.email}`}
                  aria-label={t('students.emailName', { name: person.name })}
                  className="inline-flex h-control min-w-0 max-w-full items-center justify-center px-4 text-control gap-1.5 rounded border border-border hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                >
                  <Mail className="size-4 shrink-0" aria-hidden />
                  <span className="truncate">{person.email}</span>
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
