import pt from '@/messages/pt-PT.json';
import en from '@/messages/en.json';

/**
 * Every kind of miss on the opt-out link — POOLSE-86. One page in both
 * languages, as the public water page's: telling them apart would tell a
 * stranger that a token once existed.
 */
export default function EmailPreferenceNotFound(): React.ReactElement {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 bg-background px-4 py-16 text-foreground">
      <section lang="pt-PT" className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{pt.emailPreference.notFound.title}</h1>
        <p className="text-foreground-muted">{pt.emailPreference.notFound.hint}</p>
      </section>
      <section lang="en" className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold">{en.emailPreference.notFound.title}</h2>
        <p className="text-foreground-muted">{en.emailPreference.notFound.hint}</p>
      </section>
    </main>
  );
}
