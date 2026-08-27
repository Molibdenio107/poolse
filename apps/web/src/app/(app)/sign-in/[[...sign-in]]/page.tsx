import { SignIn } from '@clerk/nextjs';

/**
 * Catch-all segment because Clerk routes its own sub-steps (factor two, password
 * reset, SSO callback) underneath this path.
 */
export default function SignInPage(): React.ReactElement {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      {/*
        `fallbackRedirectUrl`, not `forceRedirectUrl` — POOLSE-37 AC4.
        
        Fallback means "only when there is no redirect_url", so somebody who
        followed a link to a turma and had to sign in first still arrives at that
        turma. Forcing it would send them to the landing page and lose the link
        they clicked.
      */}
      <SignIn fallbackRedirectUrl="/dashboard/start" />
    </main>
  );
}
