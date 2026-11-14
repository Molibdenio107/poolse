import { SignIn } from '@clerk/nextjs';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LogoMark, Wordmark } from '@/components/logo-mark';

/**
 * Catch-all segment because Clerk routes its own sub-steps (factor two, password
 * reset, SSO callback) underneath this path.
 */
export default async function SignInPage(): Promise<React.ReactElement> {
  const t = await getTranslations();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 py-12">
      {/* The brand above Clerk's card (Rui, 14-11-2026), home on a click. */}
      <Link href="/" className="flex items-center gap-2.5 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
        <LogoMark />
        <Wordmark alt={t('app.name')} className="h-5 w-auto" />
      </Link>
      {/*
        `fallbackRedirectUrl`, not `forceRedirectUrl` — POOLSE-37 AC4.
        
        Fallback means "only when there is no redirect_url", so somebody who
        followed a link to a turma and had to sign in first still arrives at that
        turma. Forcing it would send them to the landing page and lose the link
        they clicked.

        Início, not Painel, since 10-11-2026 (Rui): Owner and Admin start there,
        and the page sends every other role on to /dashboard, which already
        knows where a family or a teacher's phone belongs.
      */}
      <SignIn fallbackRedirectUrl="/dashboard/welcome" />
    </main>
  );
}
