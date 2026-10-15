import { getTranslations } from 'next-intl/server';
import { EntityIcon } from '@/components/entity-icon';
import { FileUpload, RemovePhotoButton } from '@/components/file-upload';
import { fileUrl, type FileTarget } from '@/lib/files';
import { storageConfigured } from '@/lib/storage-status';
import { cn } from '@/lib/utils';

export interface GalleryPhoto {
  id: string;
  storageKey: string;
  fileId: string | null;
  caption: string | null;
}

/**
 * A site's or a tank's photographs, and the control that adds them.
 *
 * Built in round 4 with storage unconnected; wired on 12 October 2026. Each
 * image is read through `/files/:id`, which checks the reader on every request.
 * On an installation with no bucket the upload panel stays visible and says
 * why it is off.
 *
 * The empty state is a designed thing rather than an absence. A gallery that
 * collapses to nothing when it has no photographs reads as a broken page.
 */
export async function PhotoGallery({
  photos,
  target,
  emptyLabel,
  uploadLabel,
  canManage,
  className,
}: {
  photos: GalleryPhoto[];
  /** Where an upload is filed — `facility-photo:<id>` or `pool-photo:<id>`. */
  target: FileTarget;
  emptyLabel: string;
  uploadLabel: string;
  canManage: boolean;
  className?: string;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const configured = canManage ? await storageConfigured() : true;

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {photos.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded border border-border bg-surface-muted p-8 text-center">
          <EntityIcon kind="photo" className="size-6 text-foreground-muted" />
          <span className="text-sm text-foreground-muted">{emptyLabel}</span>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((photo, index) => {
            const url = fileUrl(photo.fileId);
            return (
              <li
                key={photo.id}
                className="relative overflow-hidden rounded border border-border bg-surface-muted"
              >
                <div className="flex aspect-video items-center justify-center">
                  {url === null ? (
                    <EntityIcon kind="photo" className="size-5 text-foreground-muted" />
                  ) : (
                    <a href={url} target="_blank" rel="noreferrer" className="size-full">
                      {/* eslint-disable-next-line @next/next/no-img-element -- streamed
                          through /files/:id after a permission check, which
                          next/image's optimiser would bypass. */}
                      <img
                        src={url}
                        // A photo with no caption is still a link, and a link
                        // whose only content has an empty alt has no name.
                        alt={photo.caption ?? t('files.photoNumber', { number: index + 1 })}
                        className="size-full object-cover"
                        loading="lazy"
                      />
                    </a>
                  )}
                </div>
                {photo.caption !== null && (
                  <p className="px-2 py-1 text-sm text-foreground-muted">{photo.caption}</p>
                )}
                {canManage && (
                  <RemovePhotoButton target={target} photoId={photo.id} label={t('files.removePhoto')} />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canManage && (
        <FileUpload
          target={target}
          variant="panel"
          label={uploadLabel}
          hint={t('files.photoHint')}
          unavailable={configured ? null : t('files.notConfigured')}
        />
      )}
    </div>
  );
}
