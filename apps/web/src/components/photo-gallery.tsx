import { EntityIcon } from '@/components/entity-icon';
import { PhotoUpload } from '@/components/photo-upload';
import { photoUrlFor } from '@/lib/photo';
import { cn } from '@/lib/utils';

export interface GalleryPhoto {
  id: string;
  storageKey: string;
  caption: string | null;
}

/**
 * A gallery and the control that will one day fill it.
 *
 * Both halves are built now with storage deliberately unconnected, because the
 * expensive part of this feature is the layout and the empty state, not the
 * upload handler. When Cloudflare R2 is configured, this component does not
 * change: `photoUrlFor` starts returning signed URLs and the upload control
 * loses its `disabled`.
 *
 * The empty state is a designed thing rather than an absence. A gallery that
 * collapses to nothing when it has no photographs reads as a broken page, and
 * this screen will have no photographs for a while yet.
 */
export function PhotoGallery({
  photos,
  emptyLabel,
  uploadLabel,
  uploadReason,
  canManage,
  className,
}: {
  photos: GalleryPhoto[];
  emptyLabel: string;
  uploadLabel: string;
  uploadReason: string;
  canManage: boolean;
  className?: string;
}): React.ReactElement {
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {photos.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded border border-border bg-surface-muted p-8 text-center">
          <EntityIcon kind="photo" className="size-6 text-foreground-muted" />
          <span className="text-sm text-foreground-muted">{emptyLabel}</span>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((photo) => {
            const url = photoUrlFor(photo.storageKey);
            return (
              <li
                key={photo.id}
                className="overflow-hidden rounded border border-border bg-surface-muted"
              >
                {/*
                  A stored key that resolves to nothing is not an error — it is
                  what every key does until storage is wired. The tile keeps its
                  shape so the grid does not collapse around it.
                */}
                <div className="flex aspect-video items-center justify-center">
                  {url === null ? (
                    <EntityIcon kind="photo" className="size-5 text-foreground-muted" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- served
                    // from object storage on a signed URL, which next/image's
                    // loader is not configured for.
                    <img
                      src={url}
                      alt={photo.caption ?? ''}
                      className="size-full object-cover"
                      loading="lazy"
                    />
                  )}
                </div>
                {photo.caption !== null && (
                  <p className="px-2 py-1 text-sm text-foreground-muted">{photo.caption}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canManage && <PhotoUpload label={uploadLabel} reason={uploadReason} />}
    </div>
  );
}
