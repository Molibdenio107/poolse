'use client';

import { useUser } from '@clerk/nextjs';
import { useTranslations } from 'next-intl';
import { EntityIcon } from '@/components/entity-icon';
import { DetachFileButton, FileUpload } from '@/components/file-upload';
import type { FileTarget } from '@/lib/files';

/**
 * A person's photograph, beside their name — Rui, 28-10-2026.
 *
 * The square that used to be a disabled placeholder (`PhotoUpload`), now with
 * the photograph in it and, for whoever may change it, *Carregar* / *Alterar*
 * and *Remover* under it. `target` null means this reader cannot change it;
 * `reason` says why in visible text (no consent, the person sets their own,
 * storage not configured) — never a tooltip.
 *
 * Three homes behind one box: your own photograph is Clerk's (`own-photo`, and
 * the avatar at the top right is refreshed after a save); a student's and a
 * staff member's without a login are the club's files.
 */
export function IdPhoto({
  url,
  name,
  target,
  reason = null,
}: {
  /** What an `<img>` loads: `/files/<id>`, or the avatar Clerk holds. */
  url: string | null;
  /** Whose face — the image's text alternative. */
  name: string;
  target: FileTarget | null;
  reason?: string | null;
}): React.ReactElement {
  const t = useTranslations();
  const { user } = useUser();
  const own = target === 'own-photo';

  return (
    <div className="flex w-28 shrink-0 flex-col gap-1.5">
      <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded border border-border bg-surface-muted text-foreground-muted">
        {url === null ? (
          <EntityIcon kind="photo" />
        ) : (
          // A file the app serves, or Clerk's own image host: no optimiser.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={t('photo.of', { name })} className="size-full object-cover" />
        )}
      </div>
      {target !== null && reason === null && (
        <>
          <FileUpload
            target={target}
            label={url === null ? t('photo.upload') : t('photo.change')}
            ariaLabel={t('photo.uploadFor', { name })}
            className="w-full [&>button]:w-full [&>button]:px-2"
            {...(own ? { onSaved: () => void user?.reload() } : {})}
          />
          {url !== null && (
            <DetachFileButton
              target={target}
              label={t('photo.remove')}
              className="w-full px-2"
              {...(own ? { onSaved: () => void user?.reload() } : {})}
            />
          )}
        </>
      )}
      {reason !== null && <span className="text-xs leading-tight text-foreground-muted">{reason}</span>}
    </div>
  );
}

