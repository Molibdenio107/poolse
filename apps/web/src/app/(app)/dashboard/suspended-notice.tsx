import { getFormatter, getTranslations } from 'next-intl/server';
import { Lock } from 'lucide-react';
import { PageShell } from '@/components/page-shell';

/**
 * What a suspended club sees — slice 3.
 *
 * The whole reason `/me` keeps answering for a suspended tenant. Every
 * tenant-scoped call behind this point would come back 403 `tenant_suspended`,
 * so without this screen the operator's owner meets a wall of "could not load"
 * boxes — one per panel — and has no idea whether the product is broken, their
 * account is gone, or they are signed in as the wrong person.
 *
 * **The reason is quoted, not summarised.** The schema requires one whenever a
 * tenant is suspended precisely so this box is never empty, and the sentence is
 * the operator's own: "Fatura de setembro por regularizar" tells somebody what
 * to do, where "a sua conta está suspensa" tells them to telephone and find out.
 *
 * **No colour-only signal and no alarm.** Warning tones rather than danger:
 * this is almost always a billing conversation, and a red full-bleed page reads
 * as "your data is gone", which is exactly what it is not. The lock is
 * decorative; the heading and the sentence carry the meaning.
 *
 * Rendered *instead of* the page, not above it, so nothing underneath fires a
 * request that is going to be refused.
 */

/**
 * Where a suspended club writes to.
 *
 * An environment variable rather than a literal, because staging and production
 * will not share an address and because correcting a typo in it should not be a
 * deploy of the application. The fallback is the real one, so an installation
 * that never sets it still shows something a person can write to — an empty
 * `mailto:` on the one screen whose whole job is "here is how to fix this"
 * would be the worst possible failure of the default.
 */
const SUPPORT_EMAIL = process.env['NEXT_PUBLIC_SUPPORT_EMAIL'] ?? 'suporte@poolse.pt';

export async function SuspendedNotice({
  organizationName,
  reason,
  suspendedAt,
}: {
  organizationName: string;
  /** The operator's own sentence. Never empty — the column refuses that. */
  reason: string | null;
  suspendedAt: string;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const format = await getFormatter();

  return (
    <PageShell title={t('suspended.title')} subtitle={organizationName}>
      <section className="flex flex-col items-start gap-4 rounded border border-warning/40 bg-warning/10 p-5">
        <div className="flex items-center gap-2 text-warning">
          <Lock className="size-5 shrink-0" aria-hidden />
          <p className="font-medium">{t('suspended.heading')}</p>
        </div>

        {reason !== null && (
          <blockquote className="border-l-2 border-warning/50 pl-3 text-foreground">
            {reason}
          </blockquote>
        )}

        <p className="text-sm text-foreground-muted">
          {t('suspended.since', {
            date: format.dateTime(new Date(suspendedAt), 'long'),
          })}
        </p>

        {/*
          What happens to their data, said plainly and before they ask. A club
          that cannot reach its register assumes the worst, and the truth —
          nothing was deleted, this is reversible — is the single most useful
          sentence on the page.
        */}
        <p className="text-sm">{t('suspended.dataSafe')}</p>

        <p className="text-sm">
          {t('suspended.contact')}{' '}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="font-medium text-primary underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {SUPPORT_EMAIL}
          </a>
        </p>
      </section>
    </PageShell>
  );
}
