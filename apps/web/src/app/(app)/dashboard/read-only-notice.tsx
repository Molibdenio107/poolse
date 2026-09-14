import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AlertTriangle } from 'lucide-react';
import { formatDate } from '@/lib/date-format';

/**
 * The trial ran out — POOLSE-61, and deliberately *not* the suspension screen.
 *
 * A suspended tenant gets a page instead of the app, because every call below it
 * refuses and the alternative is a wall of "could not load" boxes. A read-only
 * tenant is the opposite case: **everything they built is still there and still
 * readable**, every export still works, and the whole point of the state is that
 * they can look at what they would be paying for. So this is a banner above the
 * app rather than a door in front of it.
 *
 * **It is rendered from `/me`, not from a refusal.** The API's 403 carries the
 * same two dates so a form can explain itself where it failed — but a club
 * reading its register all afternoon never triggers one, and finding out you
 * cannot write only at the moment you try is how somebody loses a page of typing.
 *
 * **The call to action depends on who is looking.** Only the owner can pay —
 * `Subscrição` lives under *O meu perfil* and is the owner's own screen — so an
 * admin or an instructor is told who to ask rather than sent to a page that will
 * refuse them. A link nobody can act on is worse than a sentence.
 */
export async function ReadOnlyNotice({
  readOnlyAt,
  dataKeptUntil,
  isOwner,
}: {
  readOnlyAt: string;
  /** Null when no deletion is scheduled — an operator may set read-only alone. */
  dataKeptUntil: string | null;
  isOwner: boolean;
}): Promise<React.ReactElement> {
  const t = await getTranslations();

  return (
    <div
      // `role="status"`, not `alert`: this is a standing condition somebody is
      // living with, not something that just happened. An alert would interrupt a
      // screen reader on every navigation.
      role="status"
      className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-warning/40 bg-warning/10 px-6 py-3 text-sm print:hidden"
    >
      <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-medium">
          {t('readOnly.title', { date: formatDate(new Date(readOnlyAt)) })}
        </p>

        {/* What still works, said first — it is the reassuring half and it is
            the half that is true of everything on the screen behind this. */}
        <p className="text-foreground-muted">{t('readOnly.what')}</p>

        {dataKeptUntil !== null && (
          <p className="text-foreground-muted">
            {t('readOnly.kept', { date: formatDate(new Date(dataKeptUntil)) })}
          </p>
        )}

        {!isOwner && <p className="text-foreground-muted">{t('readOnly.askOwner')}</p>}
      </div>

      {isOwner && (
        <Link
          href="/dashboard/profile/subscription"
          className="shrink-0 rounded bg-primary px-4 py-2 text-sm text-primary-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {t('readOnly.pay')}
        </Link>
      )}
    </div>
  );
}
