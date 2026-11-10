import { SignUp } from '@clerk/nextjs';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { LEGAL_HREF } from '../../../../marketing/content';

/**
 * `?email=` seeds the address — an invitation's page sends it (29-10-2026), so
 * the person invited at one address is not left to type it again. Clerk reads
 * `?redirect_url=` itself and returns them to the invitation afterwards.
 *
 * Under it, the terms and the privacy policy every new account accepts (go-live
 * review, 10-11-2026).
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}): Promise<React.ReactElement> {
  const { email } = await searchParams;
  const t = await getTranslations();
  const href = LEGAL_HREF[(await getLocale()) === 'en' ? 'en' : 'pt-PT'];
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 py-12">
      <SignUp
        fallbackRedirectUrl="/dashboard"
        {...(email === undefined ? {} : { initialValues: { emailAddress: email } })}
      />
      <p className="max-w-sm text-center text-sm text-foreground-muted">
        {t('legal.signUpNotice')}{' '}
        <Link href={href.terms} className="underline underline-offset-2 hover:text-foreground">
          {t('legal.terms.title')}
        </Link>{' '}
        {t('legal.and')}{' '}
        <Link href={href.privacy} className="underline underline-offset-2 hover:text-foreground">
          {t('legal.privacy.title')}
        </Link>
        .
      </p>
    </main>
  );
}
