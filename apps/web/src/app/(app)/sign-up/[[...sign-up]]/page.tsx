import { SignUp } from '@clerk/nextjs';

/**
 * `?email=` seeds the address — an invitation's page sends it (29-10-2026), so
 * the person invited at one address is not left to type it again. Clerk reads
 * `?redirect_url=` itself and returns them to the invitation afterwards.
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}): Promise<React.ReactElement> {
  const { email } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-12">
      <SignUp
        fallbackRedirectUrl="/dashboard"
        {...(email === undefined ? {} : { initialValues: { emailAddress: email } })}
      />
    </main>
  );
}
