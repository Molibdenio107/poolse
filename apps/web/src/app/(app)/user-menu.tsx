'use client';

import { UserButton } from '@clerk/nextjs';
import { UserRound } from 'lucide-react';
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
 */
export function UserMenu(): React.ReactElement {
  const t = useTranslations();

  return (
    <UserButton>
      <UserButton.MenuItems>
        <UserButton.Link
          href="/dashboard/profile"
          label={t('profile.title')}
          labelIcon={<UserRound className="size-4" aria-hidden />}
        />
      </UserButton.MenuItems>
    </UserButton>
  );
}
