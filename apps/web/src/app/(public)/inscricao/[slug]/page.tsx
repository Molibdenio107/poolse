import Link from 'next/link';
import { createTranslator } from 'next-intl';
import { fetchRegistrationForm, type RegistrationForm as Loaded } from '@/lib/public-registration';
import pt from '@/messages/pt-PT.json';
import en from '@/messages/en.json';
import { RegistrationForm, type RegistrationLabels } from './registration-form';

/**
 * A club's public sign-up form — POOLSE-69.
 *
 * Linked from the club's own website or a poster at reception, filled in by a
 * parent with no account. No app shell, no Clerk: the `(public)` layout, as the
 * water page.
 *
 * **A club that has not opened its form looks exactly like one that does not
 * exist** — one sentence, no club name — because the API answers both with the
 * same 404. A club that *has* opened it publishes this link itself, so naming
 * it here reveals nothing it has not.
 *
 * **Language** is `?lang=en`, else Portuguese, for the same reason as the water
 * page: there is no session to remember a choice in.
 */
export default async function RegistrationPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lang?: string }>;
}): Promise<React.ReactElement> {
  const { slug } = await params;
  const { lang } = await searchParams;
  const locale = lang === 'en' ? 'en' : 'pt-PT';
  const t = createTranslator({ locale, messages: locale === 'en' ? en : pt });

  let loaded: Loaded | null = null;
  let failed = false;
  try {
    loaded = await fetchRegistrationForm(slug);
  } catch {
    failed = true;
  }

  const other = locale === 'en' ? { href: '?', label: 'Português' } : { href: '?lang=en', label: 'English' };

  const shell = (children: React.ReactNode): React.ReactElement => (
    <main
      lang={locale}
      className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-5 bg-background px-4 py-10 text-foreground"
    >
      <nav className="flex justify-end text-sm">
        <Link href={other.href} className="underline underline-offset-2">
          {other.label}
        </Link>
      </nav>
      {children}
    </main>
  );

  if (failed) {
    return shell(
      <>
        <h1 className="text-xl font-semibold">{t('leads.public.unavailable')}</h1>
        <p className="text-foreground-muted">{t('leads.public.unavailableHint')}</p>
      </>,
    );
  }

  if (loaded === null) {
    return shell(
      <>
        <h1 className="text-xl font-semibold">{t('leads.public.notOpen')}</h1>
        <p className="text-foreground-muted">{t('leads.public.notOpenHint')}</p>
      </>,
    );
  }

  const club = loaded.form.clubName;
  const label = (key: string): string => t(`leads.public.${key}`);
  const labels: RegistrationLabels = {
    swimmer: label('swimmer'),
    swimmerFirstName: label('swimmerFirstName'),
    swimmerLastName: label('swimmerLastName'),
    swimmerBirthDate: label('swimmerBirthDate'),
    swimmerTaxNumber: label('swimmerTaxNumber'),
    guardian: label('guardian'),
    guardianHint: t('leads.public.guardianHint', { age: loaded.form.ageOfMajority }),
    guardianName: label('guardianName'),
    guardianRelationship: label('guardianRelationship'),
    guardianRelationshipHint: label('guardianRelationshipHint'),
    guardianTaxNumber: label('guardianTaxNumber'),
    contact: label('contact'),
    email: label('email'),
    emailHint: label('emailHint'),
    phone: label('phone'),
    preferences: label('preferences'),
    facility: label('facility'),
    level: label('level'),
    noPreference: label('noPreference'),
    days: label('days'),
    daysHint: label('daysHint'),
    note: label('note'),
    noteHint: label('noteHint'),
    consent: t('leads.public.consent', { club, months: 12 }),
    submit: label('submit'),
    sending: label('sending'),
    sentTitle: label('sentTitle'),
    sentBody: t('leads.public.sentBody', { club }),
    failed: label('failed'),
    optional: label('optional'),
    honeypot: label('honeypot'),
  };

  const errorKeys = [
    'required', 'tooLong', 'invalidNif', 'invalidDate', 'invalidEmail',
    'guardianRequired', 'sameNif', 'consentRequired',
  ];
  const errors = Object.fromEntries(
    errorKeys.map((key) => [
      `leads.public.${key}`,
      t(`leads.public.${key}`, { age: loaded.form.ageOfMajority }),
    ]),
  );

  const weekdays = [1, 2, 3, 4, 5, 6, 7].map((value) => ({
    value,
    label: t(`week.${value}`),
  }));

  return shell(
    <>
      <header className="flex flex-col gap-1">
        <p className="text-sm text-foreground-muted">{club}</p>
        <h1 className="text-2xl font-semibold">{t('leads.public.title')}</h1>
        <p className="text-foreground-muted">{t('leads.public.intro')}</p>
      </header>
      <RegistrationForm
        slug={slug}
        locale={locale}
        stamp={loaded.stamp}
        majority={loaded.form.ageOfMajority}
        facilities={loaded.form.facilities}
        levels={loaded.form.levels}
        weekdays={weekdays}
        labels={labels}
        errors={errors}
      />
    </>,
  );
}
