import { LEGAL_HREF, translator, type MarketingLocale } from './content';
import { MarketingShell } from './shell';

/**
 * The privacy policy and the terms — go-live review, 10-11-2026.
 *
 * Static and public like the rest of the marketing pages, linked from their
 * footer, from sign-up and from a club's public registration form. The words are
 * in the catalogues (`legal.*`), pt-PT first; a section's body is paragraphs
 * separated by a blank line, and a paragraph whose lines all start with "- " is
 * a list. The facts it states (retention, who sees what, the processors) are
 * `docs/features/retention.md`, `docs/features/trial.md` and `docs/deploy.md`:
 * a change there is a change here.
 */
const SECTIONS = {
  privacy: ['roles', 'data', 'purposes', 'children', 'access', 'retention', 'processors', 'rights', 'security', 'cookies', 'changes'],
  terms: ['pilot', 'accounts', 'clubData', 'processing', 'use', 'trial', 'documents', 'liability', 'end', 'law'],
} as const;

export type LegalDocument = keyof typeof SECTIONS;

export { LEGAL_HREF };

const SUPPORT_EMAIL = process.env['NEXT_PUBLIC_SUPPORT_EMAIL'] || 'suporte@poolse.pt';

export function LegalPage({
  locale,
  document,
}: {
  locale: MarketingLocale;
  document: LegalDocument;
}): React.ReactElement {
  const t = translator(locale);

  return (
    <MarketingShell locale={locale}>
      <article className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">{t(`legal.${document}.title`)}</h1>
        <p className="mt-2 text-sm text-foreground-muted">{t('legal.updated')}</p>
        <p className="mt-6">{t(`legal.${document}.intro`)}</p>

        {SECTIONS[document].map((id) => (
          <section key={id} className="mt-8">
            <h2 className="font-heading text-xl font-semibold">{t(`legal.${document}.sections.${id}.title`)}</h2>
            <Body text={t(`legal.${document}.sections.${id}.body`)} />
          </section>
        ))}

        <section className="mt-8">
          <h2 className="font-heading text-xl font-semibold">{t('legal.contact')}</h2>
          <p className="mt-3">
            <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-2">
              {SUPPORT_EMAIL}
            </a>
          </p>
        </section>
      </article>
    </MarketingShell>
  );
}

function Body({ text }: { text: string }): React.ReactElement {
  return (
    <>
      {text.split('\n\n').map((paragraph, index) => {
        const lines = paragraph.split('\n');
        if (lines.every((line) => line.startsWith('- '))) {
          return (
            <ul key={index} className="mt-3 list-disc space-y-1.5 pl-6">
              {lines.map((line) => (
                <li key={line}>{line.slice(2)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index} className="mt-3">
            {paragraph}
          </p>
        );
      })}
    </>
  );
}
