import { SignIn } from '@clerk/nextjs';

/**
 * Catch-all segment because Clerk routes its own sub-steps (factor two, password
 * reset, SSO callback) underneath this path.
 */
export default function SignInPage(): React.ReactElement {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <SignIn />
    </main>
  );
}
