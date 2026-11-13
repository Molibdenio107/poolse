'use client';

import { aiNoteKey } from '@/lib/ai-failure-codes';
import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Camera, Lock, Trash2 } from 'lucide-react';
import { DropOverlay, useFileDrop } from '@/components/file-drop';
import { DocumentLink } from '@/components/file-upload';
import { Dialog } from '@/components/ui/dialog';
import { formatDate } from '@/lib/date-format';
import { acceptFor } from '@/lib/files';
import { useSavedAction } from '@/lib/saved';
import type { StaffIdentity } from '@/lib/api';
import type { FormState } from '../../../actions';
import { IdentityCard } from './identity-card';
import {
  removeStaffIdPhotoAction,
  uploadStaffIdPhotoAction,
  type StaffIdPhotoState,
} from './identity.actions';

const SIDES = ['front', 'back'] as const;
type Side = (typeof SIDES)[number];

/**
 * *Identificação* — POOLSE-149 slice B. The ID document's number (POOLSE-100)
 * and its photograph, front and back.
 *
 * A file dropped anywhere on the screen is the front, or the back once the
 * front is on file; each side also has its own button. A photograph is shown
 * as a link rather than drawn on the page: every look at somebody else's is an
 * audited read, and a thumbnail would record one on every visit.
 */
export function Identification({
  membershipId,
  identity,
  own,
  canEdit,
  storageReady,
}: {
  membershipId: string;
  identity: StaffIdentity;
  own: boolean;
  /** The Owner, or the person; an Admin reads (Rui, 07-11-2026). */
  canEdit: boolean;
  storageReady: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [state, dispatch, pending] = useSavedAction(uploadStaffIdPhotoAction, { ok: false } as StaffIdPhotoState);

  const send = useCallback(
    (file: File, side: Side): void => {
      if (!canEdit) return;
      if (!storageReady) return;
      const data = new FormData();
      data.set('membershipId', membershipId);
      data.set('side', side);
      data.set('file', file);
      startTransition(() => dispatch(data));
    },
    [dispatch, membershipId, storageReady],
  );
  const dropSide: Side = identity.photos.front !== null && identity.photos.back === null ? 'back' : 'front';
  const { dragging } = useFileDrop((file) => send(file, dropSide));

  return (
    <>
      <DropOverlay shown={dragging && storageReady} label={t(`staffIdentity.photo.drop.${dropSide}`)} />
      <section className="flex flex-col gap-3 rounded bg-surface p-5 shadow-card">
        <h2 className="flex items-center gap-1.5 font-medium">
          <Camera className="size-4" aria-hidden />
          {t('staffIdentity.photo.title')}
        </h2>
        <p className="flex items-start gap-1.5 text-sm text-foreground-muted">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t('staffIdentity.photo.intro', { months: identity.retentionMonths })}
        </p>
        <fieldset disabled={!canEdit} className="grid gap-3 sm:grid-cols-2">
          {SIDES.map((side) => (
            <PhotoSide
              key={side}
              membershipId={membershipId}
              side={side}
              photo={identity.photos[side]}
              storageReady={storageReady}
              pending={pending}
              onFile={(file) => send(file, side)}
            />
          ))}
        </fieldset>
        <span className="text-sm text-foreground-muted">
          {storageReady ? t('staffIdentity.photo.hint') : t('files.notConfigured')}
        </span>
        {state.readNote !== undefined && (
          <span className="text-sm text-foreground-muted">{t(aiNoteKey('documents.idPhoto.note', state.readNote))}</span>
        )}
      </section>

      <IdentityCard membershipId={membershipId} identity={identity} own={own} canEdit={canEdit} ownerCorrects={canEdit && !own} proposal={state.proposal ?? null} />
    </>
  );
}

function PhotoSide({
  membershipId,
  side,
  photo,
  storageReady,
  pending,
  onFile,
}: {
  membershipId: string;
  side: Side;
  photo: StaffIdentity['photos'][Side];
  storageReady: boolean;
  pending: boolean;
  onFile: (file: File) => void;
}): React.ReactElement {
  const t = useTranslations();
  const input = useRef<HTMLInputElement>(null);
  const [removed, remove, removing] = useSavedAction(removeStaffIdPhotoAction, { ok: false } as FormState);
  const [asking, setAsking] = useState(false);
  // Closed once the removal went through; a refusal leaves it open to say so.
  useEffect(() => {
    if (removed.ok) setAsking(false);
  }, [removed]);

  return (
    <div className="flex flex-col items-start gap-2 rounded border border-border p-4">
      <span className="text-sm font-medium">{t(`staffIdentity.photo.side.${side}`)}</span>
      {photo === null ? (
        <span className="text-sm text-foreground-muted">{t('staffIdentity.photo.none')}</span>
      ) : (
        <>
          <DocumentLink fileId={photo.fileId} contentType={photo.contentType} fileName={photo.originalName} />
          <span className="text-sm text-foreground-muted">
            {t('staffIdentity.photo.filedOn', { date: formatDate(photo.createdAt.slice(0, 10)) })}
          </span>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!storageReady || pending}
          onClick={() => input.current?.click()}
          className="inline-flex h-control items-center justify-center gap-2 rounded-sm bg-surface px-4 text-control shadow-card hover:bg-surface-muted disabled:opacity-60"
        >
          <Camera className="size-4" aria-hidden />
          {pending ? t('staffIdentity.photo.sending') : photo === null ? t('staffIdentity.photo.upload') : t('staffIdentity.photo.replace')}
        </button>
        {photo !== null && (
          <button
            type="button"
            onClick={() => setAsking(true)}
            className="inline-flex h-control items-center justify-center gap-2 rounded-sm bg-surface px-4 text-control text-foreground-muted shadow-card hover:text-danger"
          >
            <Trash2 className="size-4" aria-hidden />
            {t('staffIdentity.photo.remove')}
          </button>
        )}
      </div>
      <Dialog
        open={asking}
        onClose={() => setAsking(false)}
        title={t('staffIdentity.photo.removeTitle')}
        description={t(`staffIdentity.photo.side.${side}`)}
        closeLabel={t('common.close')}
      >
        <p className="text-sm">{t('staffIdentity.photo.removeBody')}</p>
        <form action={remove} className="mt-4 flex flex-wrap justify-end gap-2">
          <input type="hidden" name="membershipId" value={membershipId} />
          <input type="hidden" name="side" value={side} />
          <button
            type="button"
            onClick={() => setAsking(false)}
            className="inline-flex h-control items-center justify-center rounded-sm bg-surface px-4 text-control shadow-card hover:bg-surface-muted"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={removing}
            className="inline-flex h-control items-center justify-center gap-2 rounded-sm border border-danger/50 px-4 text-control text-danger hover:bg-danger/10 disabled:opacity-60"
          >
            <Trash2 className="size-4" aria-hidden />
            {t('staffIdentity.photo.removeConfirm')}
          </button>
        </form>
      </Dialog>
      <input
        ref={input}
        type="file"
        className="hidden"
        aria-label={t(`staffIdentity.photo.side.${side}`)}
        data-drop-ask="true"
        accept={acceptFor('student_document')}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) onFile(file);
          event.target.value = '';
        }}
      />
    </div>
  );
}
