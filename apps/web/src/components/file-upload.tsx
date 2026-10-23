'use client';

import { startTransition, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Paperclip } from 'lucide-react';
import {
  detachFileAction,
  removePhotoAction,
  uploadFileAction,
} from '@/app/(app)/dashboard/files.actions';
import type { FormState } from '@/app/(app)/dashboard/actions';
import { EntityIcon } from '@/components/entity-icon';
import { acceptFor, isImagePurpose, MAX_FILE_BYTES, purposeOf, WORD_TYPE, type FileTarget } from '@/lib/files';
import { useSavedAction } from '@/lib/saved';
import { cn } from '@/lib/utils';

const INITIAL: FormState = { ok: false };


/**
 * Choosing a file and filing it — 12 October 2026.
 *
 * A click opens the picker; the `panel` form also takes a file dropped on it.
 * A photograph is **shrunk in the browser** before it leaves (longest edge
 * 2000 px, JPEG) — a phone's 6 MB picture becomes a few hundred KB, which is
 * what a gallery needs and what keeps a club inside the bucket's free tier. A
 * document is sent as it is.
 *
 * `unavailable` is the reason the control is off — storage not configured on
 * this installation — always shown as text, never only a tooltip.
 */
export function FileUpload({
  target,
  label,
  hint,
  unavailable,
  variant = 'button',
  className,
  ariaLabel,
}: {
  target: FileTarget;
  label: string;
  /**
   * The button's full name where the visible label repeats down a list — "Anexar"
   * on every row of Qualificações says nothing about which row (POOLSE-97).
   */
  ariaLabel?: string | undefined;
  /** What will be accepted, said beside the control. */
  hint?: string | undefined;
  unavailable?: string | null;
  variant?: 'button' | 'panel';
  className?: string;
}): React.ReactElement {
  const t = useTranslations();
  const input = useRef<HTMLInputElement>(null);
  const [, dispatch, isPending] = useSavedAction(uploadFileAction, INITIAL);
  const [preparing, setPreparing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const purpose = purposeOf(target);
  const off = unavailable !== undefined && unavailable !== null;
  const busy = isPending || preparing;

  async function send(file: File): Promise<void> {
    setPreparing(true);
    let ready = file;
    try {
      if (isImagePurpose(purpose)) ready = await shrink(file, purpose === 'logo' ? 1000 : 2000);
    } finally {
      setPreparing(false);
    }
    const data = new FormData();
    data.set('target', target);
    data.set('file', ready);
    startTransition(() => dispatch(data));
  }

  function chosen(files: FileList | null): void {
    const file = files?.[0];
    if (file !== undefined) void send(file);
    if (input.current !== null) input.current.value = '';
  }

  const button = (
    <button
      type="button"
      disabled={off || busy}
      onClick={() => input.current?.click()}
      aria-label={ariaLabel}
      className={cn(
        'inline-flex h-control items-center justify-center gap-2 rounded border border-border bg-surface px-4 text-control text-foreground hover:bg-surface-muted',
        (off || busy) && 'cursor-not-allowed opacity-60',
      )}
    >
      {isImagePurpose(purpose) ? (
        <EntityIcon kind="photo" />
      ) : (
        <Paperclip className="size-4" aria-hidden="true" />
      )}
      {busy ? t('files.uploading') : label}
    </button>
  );

  const picker = (
    <input
      ref={input}
      type="file"
      className="hidden"
      accept={acceptFor(purpose)}
      onChange={(event) => chosen(event.target.files)}
    />
  );

  if (variant === 'button') {
    return (
      <div className={cn('flex flex-col items-start gap-1', className)}>
        {button}
        {picker}
        {(off || hint !== undefined) && (
          <span className="text-sm text-foreground-muted">{off ? unavailable : hint}</span>
        )}
      </div>
    );
  }

  return (
    <div
      onDragOver={(event) => {
        if (off || busy) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!off && !busy) chosen(event.dataTransfer.files);
      }}
      className={cn(
        'flex flex-col items-center gap-2 rounded border border-dashed border-border bg-surface-muted p-6 text-center',
        dragging && 'border-primary bg-primary/10',
        className,
      )}
    >
      {button}
      {picker}
      <span className="text-sm text-foreground-muted">
        {off ? unavailable : (hint ?? t('files.dropHint'))}
      </span>
    </div>
  );
}

/** A small "remove" on a gallery tile. The file stays on record; the tile goes. */
export function RemovePhotoButton({
  target,
  photoId,
  label,
}: {
  target: FileTarget;
  photoId: string;
  label: string;
}): React.ReactElement {
  const [, dispatch, isPending] = useSavedAction(removePhotoAction, INITIAL);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={isPending}
      onClick={() => {
        const data = new FormData();
        data.set('target', target);
        data.set('photoId', photoId);
        startTransition(() => dispatch(data));
      }}
      className="absolute right-1 top-1 inline-flex size-7 items-center justify-center rounded bg-surface/90 text-foreground shadow hover:bg-surface disabled:opacity-60"
    >
      <span aria-hidden="true">×</span>
    </button>
  );
}

/** Takes a document off its record. */
export function DetachFileButton({ target, label }: { target: FileTarget; label: string }): React.ReactElement {
  const [, dispatch, isPending] = useSavedAction(detachFileAction, INITIAL);
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        const data = new FormData();
        data.set('target', target);
        startTransition(() => dispatch(data));
      }}
      className="inline-flex h-control items-center justify-center rounded border border-border bg-surface px-4 text-control text-foreground hover:bg-surface-muted disabled:opacity-60"
    >
      {label}
    </button>
  );
}

/**
 * A photograph at a sensible size. Anything already small enough is sent as
 * chosen; anything the browser cannot decode (an iPhone HEIC, say) is sent as
 * it is and refused by the API in words, rather than failing here in silence.
 */
async function shrink(file: File, longestEdge: number): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  const scale = Math.min(1, longestEdge / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= MAX_FILE_BYTES / 4) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  // A logo keeps its transparency; a photograph has none to keep.
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
  if (blob === null) return file;
  const name = file.name.replace(/\.[^.]+$/, '') + (type === 'image/png' ? '.png' : '.jpg');
  return new File([blob], name, { type });
}

/**
 * A record's one document — an apólice, a partnership's contract, a
 * certificate. Shows a link when there is one and, for whoever may file it,
 * the control to add, replace or remove it. `once` is the certificate's rule:
 * attached once, never swapped (a different scan is a different record).
 *
 * A Word file (a contract, POOLSE-105) is a download — no browser shows one —
 * so its link says so and carries the file's own name; `contentType` and
 * `fileName` say which it is when the caller knows.
 */
export function AttachedDocument({
  fileId,
  target,
  canManage,
  storageReady,
  once = false,
  contentType,
  fileName,
}: {
  fileId: string | null;
  target: FileTarget;
  canManage: boolean;
  storageReady: boolean;
  once?: boolean;
  contentType?: string | undefined;
  fileName?: string | undefined;
}): React.ReactElement | null {
  const t = useTranslations();
  if (fileId === null && !canManage) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {fileId !== null ? (
        <DocumentLink fileId={fileId} contentType={contentType} fileName={fileName} />
      ) : (
        <span className="text-sm text-foreground-muted">{t('files.noDocument')}</span>
      )}
      {canManage && (fileId === null || !once) && (
        <FileUpload
          target={target}
          label={fileId === null ? t('files.attachDocument') : t('files.replaceDocument')}
          hint={
            fileId !== null
              ? undefined
              : purposeOf(target) === 'agreement_document'
                ? t('files.contractHint')
                : t('files.documentHint')
          }
          unavailable={storageReady ? null : t('files.notConfigured')}
        />
      )}
      {canManage && fileId !== null && !once && (
        <DetachFileButton target={target} label={t('files.removeDocument')} />
      )}
    </div>
  );
}

/**
 * One stored document as a link: opened in a new tab, or — for Word — saved
 * under its own name (the API serves it as an attachment).
 */
export function DocumentLink({
  fileId,
  contentType,
  fileName,
  quiet = false,
}: {
  fileId: string;
  contentType?: string | undefined;
  fileName?: string | undefined;
  /** A plain text link, for a line in a list rather than a button. */
  quiet?: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const word = contentType === WORD_TYPE;
  const label = quiet && fileName !== undefined
    ? fileName
    : word
      ? t('files.downloadDocument')
      : t('files.viewDocument');
  return (
    <a
      href={`/files/${fileId}`}
      {...(word ? { download: fileName ?? true } : { target: '_blank', rel: 'noreferrer' })}
      className={
        quiet
          ? 'inline-flex items-center gap-1.5 text-primary underline-offset-2 hover:underline coarse:-my-3 coarse:py-3'
          : 'inline-flex h-control items-center justify-center gap-2 rounded border border-border bg-surface px-4 text-control text-primary hover:bg-surface-muted'
      }
    >
      <Paperclip className="size-4" aria-hidden="true" />
      {label}
    </a>
  );
}
