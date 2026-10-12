'use client';

import { UserButton } from '@clerk/nextjs';
import { Archive, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';

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
 */
export function UserMenu({ canArchive = false }: { canArchive?: boolean }): React.ReactElement {
  const t = useTranslations();

  return (
    <UserButton>
      <UserButton.MenuItems>
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
  );
}
