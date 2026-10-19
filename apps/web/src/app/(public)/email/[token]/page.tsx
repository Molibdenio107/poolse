import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createTranslator } from 'next-intl';
import { CheckCircle2, MailX } from 'lucide-react';
import { fetchEmailPreference, type PublicEmailPreference } from '@/lib/public-email';
import pt from '@/messages/pt-PT.json';
import en from '@/messages/en.json';
import { setPreferenceAction } from './email.actions';

/**
 * The opt-out link — POOLSE-86, 3.0c.
 *
 * Opened from a club message's footer, with no login. It says which club, what
 * stopping covers and what it does not (Rui, 19-10-2026: only general club
 * messages — closure warnings, payment reminders and account mail always go),
 * and offers the one choice the state allows. Opting back in is the same page.
 *
 * **Language** is `?lang=en`, else the club's; there is no session to remember a
 * choice in.
 */
export default async function EmailPreferencePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string; saved?: string; failed?: string }>;
}): Promise<React.ReactElement> {
  const { token } = await params;
  const { lang, saved, failed } = await searchParams;

  // Undefined: the API could not be reached; null: no such link.
  let page: PublicEmailPreference | null | undefined;
  try {
    page = await fetchEmailPreference(token);
  } catch {
    page = undefined;
  }
  const locale = lang === 'en' || (lang === undefined && page?.locale === 'en') ? 'en' : 'pt-PT';
  const t = createTranslator({ locale, messages: locale === 'en' ? en : pt });

  if (page === undefined) {
    return (
      <main lang={locale} className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-2 bg-background px-4 py-16 text-foreground">
        <h1 className="text-xl font-semibold">{t('emailPreference.unavailable')}</h1>
        <p className="text-foreground-muted">{t('emailPreference.unavailableHint')}</p>
      </main>
    );
  }
  if (page === null) notFound();

  const other = locale === 'en' ? 'pt-PT' : 'en';
  return (
    <main lang={locale} className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-6 bg-background px-4 py-16 text-foreground">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-foreground-muted">{page.clubName}</p>
        <h1 className="text-2xl font-semibold">{t('emailPreference.title')}</h1>
      </header>

      {saved === '1' && (
        <p role="status" className="flex items-center gap-2 rounded border border-success/40 bg-success/5 p-3 text-sm">
          <CheckCircle2 aria-hidden className="size-4 shrink-0 text-success" />
          {t('emailPreference.saved')}
        </p>
      )}
      {failed === '1' && (
        <p role="alert" className="rounded border border-danger/40 p-3 text-sm text-danger">
          {t('emailPreference.failed')}
        </p>
      )}

      <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
        <p className="flex items-start gap-2 font-medium">
          {page.optedOut && <MailX aria-hidden className="mt-0.5 size-5 shrink-0 text-foreground-muted" />}
          {t(page.optedOut ? 'emailPreference.isOut' : 'emailPreference.isIn', { club: page.clubName })}
        </p>
        <p className="text-sm text-foreground-muted">{t('emailPreference.alwaysSent')}</p>
        <form action={setPreferenceAction}>
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="optedOut" value={page.optedOut ? 'false' : 'true'} />
          {(lang === 'en' || lang === 'pt') && <input type="hidden" name="lang" value={lang} />}
          <button
            type="submit"
            className="inline-flex h-control items-center justify-center rounded bg-primary px-4 text-control text-primary-foreground hover:bg-primary/90"
          >
            {t(page.optedOut ? 'emailPreference.optIn' : 'emailPreference.optOut')}
          </button>
        </form>
      </section>

      <Link
        href={`/email/${encodeURIComponent(token)}?lang=${other === 'en' ? 'en' : 'pt'}`}
        className="self-start text-sm text-primary underline underline-offset-4"
      >
        {t('emailPreference.otherLanguage')}
      </Link>
    </main>
  );
}
