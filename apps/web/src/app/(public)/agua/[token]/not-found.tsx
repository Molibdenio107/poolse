import pt from '@/messages/pt-PT.json';
import en from '@/messages/en.json';

/**
 * Every kind of miss on the public water page — POOLSE-71.
 *
 * Unknown, switched off, replaced: one page, because telling them apart would
 * tell a stranger that a token once existed. Both languages, since a 404 has no
 * `?lang` to read and a visitor may be either.
 */
export default function PublicWaterNotFound(): React.ReactElement {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 bg-background px-4 py-16 text-foreground">
      <section lang="pt-PT" className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{pt.publicWater.notFound.title}</h1>
        <p className="text-foreground-muted">{pt.publicWater.notFound.hint}</p>
      </section>
      <section lang="en" className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold">{en.publicWater.notFound.title}</h2>
        <p className="text-foreground-muted">{en.publicWater.notFound.hint}</p>
      </section>
    </main>
  );
}
