'use client';

import { UserButton } from '@clerk/nextjs';
import { AlertTriangle, Archive, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { subscriptionAlertSentence, type SubscriptionAlertView } from '@/lib/subscription-alert';

/**
 * The avatar menu at the top right, carrying sign-out and now "O meu perfil".
 *
 * A client component so the label can be translated. Clerk's own menu items —
 * "Manage account", "Sign out" — come translated by the localization passed to
 * `ClerkProvider`; ours is ours to translate, and an English label sitting under
 * two Portuguese ones is exactly the kind of thing `pnpm i18n:check` cannot see.
 *
 * The profile link is added rather than replacing "Manage account": that one
 * opens Clerk's own screens, which is where an email change gets verified and a
 * password gets set. Ours holds the fields Clerk has never heard of.
 *
 * *Arquivados* sits beside it for an Owner or Admin — POOLSE-78, placed here by
 * Rui rather than in the main navigation, because it is where somebody goes
 * after a mistake, not part of the day. Hiding it is not the control: the API
 * refuses everybody else.
 *
 * **The subscription warning** (Rui, 28-10-2026) — for the owner and the admins
 * only, when the club's access is about to stop or has. A small warning icon on
 * the avatar, and the sentence that explains it first in the menu: the icon
 * alone says nothing, so the words are always one click away and never in a
 * tooltip. The owner's line opens Subscrição; an admin's says only the owner can
 * renew, because the page is the owner's alone.
 */
export function UserMenu({
  canArchive = false,
  subscription = null,
}: {
  canArchive?: boolean;
  subscription?: SubscriptionAlertView | null;
}): React.ReactElement {
  const t = useTranslations();
  const alert = subscription?.alert ?? null;
  const sentence = alert === null ? null : subscriptionAlertSentence(t, alert);
  const warningIcon = <AlertTriangle className="size-4 text-warning" aria-hidden />;

  return (
    <span className="relative inline-flex">
      <UserButton>
        <UserButton.MenuItems>
          {sentence !== null && subscription?.canOpen === true && (
            <UserButton.Link
              href="/dashboard/profile/subscription"
              label={sentence}
              labelIcon={warningIcon}
            />
          )}
          {sentence !== null && subscription?.canOpen !== true && (
            <UserButton.Action
              label={`${sentence} ${t('subscriptionAlert.ownerRenews')}`}
              labelIcon={warningIcon}
              onClick={() => undefined}
            />
          )}
          <UserButton.Link
            href="/dashboard/profile"
            label={t('profile.title')}
            labelIcon={<UserRound className="size-4" aria-hidden />}
          />
          {canArchive && (
            <UserButton.Link
              href="/dashboard/arquivados"
              label={t('archive.title')}
              labelIcon={<Archive className="size-4" aria-hidden />}
            />
          )}
        </UserButton.MenuItems>
      </UserButton>
      {sentence !== null && (
        // On the avatar's corner; it takes no click, so the avatar still opens the menu.
        <span className="pointer-events-none absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-surface ring-1 ring-border">
          <AlertTriangle className="attention size-3 text-warning" aria-hidden />
          <span className="sr-only">{t('subscriptionAlert.badge')}</span>
        </span>
      )}
    </span>
  );
}
