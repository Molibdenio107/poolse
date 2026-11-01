'use client';

import { Minus, Plus, Trash2, Upload, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import {
  BOLETIM_FIELD_GROUPS,
  BOLETIM_SIZE_DEFAULT,
  BOLETIM_SIZE_MAX,
  BOLETIM_SIZE_MIN,
  type BoletimField,
  type BoletimPlacement,
} from '@poolse/rules';
import { BoletimSheet, placementStyle } from '@/components/boletim-sheet';
import { Dialog } from '@/components/ui/dialog';
import { fileUrl } from '@/lib/files';
import { pageImage } from '@/lib/page-image';
import { useSavedAction } from '@/lib/saved';
import { cn } from '@/lib/utils';
import { uploadFileAction } from '../../files.actions';
import type { FormState } from '../../actions';
import { removeBoletimTemplateAction, saveBoletimFieldsAction, type BoletimTemplate } from './boletim-template.actions';

const SECONDARY =
  'inline-flex h-control items-center justify-center gap-2 rounded-sm bg-surface px-4 text-control text-foreground shadow-card hover:bg-surface-muted disabled:opacity-60';
const PRIMARY =
  'inline-flex h-control items-center justify-center gap-2 rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground disabled:opacity-60';
const ICON = 'inline-flex size-8 items-center justify-center rounded-sm text-foreground-muted hover:bg-surface-muted hover:text-foreground coarse:size-11';

interface Placed extends BoletimPlacement {
  key: string;
}

const INITIAL: FormState = { ok: false };
let next = 0;
const keyed = (fields: readonly BoletimPlacement[]): Placed[] => fields.map((f) => ({ ...f, key: `p${next++}` }));
const plain = (placed: readonly Placed[]): BoletimPlacement[] =>
  placed.map(({ field, x, y, sizePt }) => ({ field, x, y, sizePt }));
const clamp = (v: number): number => Math.min(1, Math.max(0, Math.round(v * 10000) / 10000));

/**
 * The club's own boletim — POOLSE-142. Upload the form (a PDF's first page is
 * drawn to an image here, in the browser), then arm a field in the list and
 * click its line on the form. A placed field is dragged, nudged with the arrow
 * keys, resized, or removed; the set is saved as one.
 */
export function BoletimTemplateEditor({
  template,
  storageReady,
}: {
  template: BoletimTemplate | null;
  storageReady: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const seeded = useMemo(() => JSON.stringify(template?.fields ?? []), [template]);
  const [placed, setPlaced] = useState<Placed[]>(() => keyed(template?.fields ?? []));
  const [armed, setArmed] = useState<BoletimField | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [onlyFirst, setOnlyFirst] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const sheet = useRef<HTMLDivElement>(null);

  // A new template, or placements saved elsewhere: start again from the server's.
  useEffect(() => {
    setPlaced(keyed(JSON.parse(seeded) as BoletimPlacement[]));
    setSelected(null);
  }, [seeded, template?.id]);

  const [uploadState, upload, uploading] = useSavedAction(uploadFileAction, INITIAL);
  const [saveState, save, saving] = useSavedAction(saveBoletimFieldsAction, INITIAL);
  const [, remove, removing] = useSavedAction(removeBoletimTemplateAction, INITIAL);
  const dirty = JSON.stringify(plain(placed)) !== seeded;
  const current = placed.find((p) => p.key === selected) ?? null;

  const send = async (file: File): Promise<void> => {
    setProblem(null);
    setConverting(true);
    try {
      const { blob, pages } = await pageImage(file);
      setOnlyFirst(pages > 1);
      const form = new FormData();
      form.set('target', 'boletim-template');
      form.set('file', new File([blob], 'boletim.jpg', { type: 'image/jpeg' }));
      startTransition(() => upload(form));
    } catch {
      setProblem('boletimTemplate.unreadable');
    } finally {
      setConverting(false);
    }
  };

  const chosen = (file: File | undefined): void => {
    if (input.current !== null) input.current.value = '';
    if (file === undefined) return;
    // Replacing drops the placements (rule 6): ask first when there are any.
    if (template !== null && template.fields.length > 0) setPendingFile(file);
    else void send(file);
  };

  const move = (key: string, x: number, y: number): void =>
    setPlaced((all) => all.map((p) => (p.key === key ? { ...p, x: clamp(x), y: clamp(y) } : p)));
  const resize = (key: string, by: number): void =>
    setPlaced((all) =>
      all.map((p) =>
        p.key === key ? { ...p, sizePt: Math.min(BOLETIM_SIZE_MAX, Math.max(BOLETIM_SIZE_MIN, p.sizePt + by)) } : p,
      ),
    );
  const drop = (key: string): void => {
    setPlaced((all) => all.filter((p) => p.key !== key));
    setSelected(null);
  };

  const at = (event: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const box = sheet.current?.getBoundingClientRect();
    if (box === undefined || box.width === 0) return null;
    return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height };
  };

  const placeHere = (event: React.MouseEvent): void => {
    if (armed === null) {
      setSelected(null);
      return;
    }
    const point = at(event);
    if (point === null) return;
    const [added] = keyed([{ field: armed, x: clamp(point.x), y: clamp(point.y), sizePt: BOLETIM_SIZE_DEFAULT }]);
    setPlaced((all) => [...all, added!]);
    setSelected(added!.key);
    setArmed(null);
  };

  const drag = (event: React.PointerEvent<HTMLButtonElement>, p: Placed): void => {
    event.stopPropagation();
    setSelected(p.key);
    const start = at(event);
    if (start === null) return;
    const from = { x: p.x, y: p.y };
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const onMove = (e: PointerEvent): void => {
      const now = at(e);
      if (now !== null) move(p.key, from.x + now.x - start.x, from.y + now.y - start.y);
    };
    const onUp = (): void => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  const keys = (event: React.KeyboardEvent, p: Placed): void => {
    const step = event.shiftKey ? 0.01 : 0.001;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const by = moves[event.key];
    if (by !== undefined) {
      event.preventDefault();
      move(p.key, p.x + by[0], p.y + by[1]);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      drop(p.key);
    } else if (event.key === '+' || event.key === '=') {
      resize(p.key, 1);
    } else if (event.key === '-') {
      resize(p.key, -1);
    }
  };

  const busy = converting || uploading;
  const imageUrl = template === null ? null : fileUrl(template.fileId);
  const label = (field: BoletimField): string => t(`boletimTemplate.field.${field}`);
  const failure = problem ?? (uploadState.ok === false ? uploadState.errorKey : undefined);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          className="hidden"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          onChange={(event) => chosen(event.target.files?.[0])}
        />
        <button
          type="button"
          className={SECONDARY}
          disabled={!storageReady || busy}
          onClick={() => input.current?.click()}
        >
          <Upload aria-hidden className="size-4" />
          {busy
            ? t('boletimTemplate.uploading')
            : template === null
              ? t('boletimTemplate.upload')
              : t('boletimTemplate.replace')}
        </button>
        {template !== null && (
          <button type="button" className={SECONDARY} disabled={removing} onClick={() => setConfirmRemove(true)}>
            <Trash2 aria-hidden className="size-4" />
            {t('boletimTemplate.remove')}
          </button>
        )}
      </div>
      {!storageReady && <p className="text-sm text-foreground-muted">{t('files.notConfigured')}</p>}
      {failure !== undefined && <p className="text-sm text-danger">{t(failure)}</p>}
      {onlyFirst && <p className="text-sm text-foreground-muted">{t('boletimTemplate.firstPageOnly')}</p>}

      {imageUrl !== null && (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="min-w-0">
            <p className="mb-2 text-sm text-foreground-muted">
              {armed === null
                ? t('boletimTemplate.howTo')
                : t('boletimTemplate.armed', { field: label(armed) })}
            </p>
            <div
              ref={sheet}
              className={cn('max-w-[40rem] rounded border border-border', armed !== null && 'cursor-crosshair')}
            >
              {/* A click on the form places the armed field; the keyboard places nothing, it moves what is placed. */}
              <div onClick={placeHere}>
                <BoletimSheet imageUrl={imageUrl} alt={t('boletimTemplate.alt')}>
                  {placed.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      style={placementStyle(p)}
                      onPointerDown={(event) => drag(event, p)}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => keys(event, p)}
                      onFocus={() => setSelected(p.key)}
                      aria-label={t('boletimTemplate.placedLabel', { field: label(p.field) })}
                      className={cn(
                        'absolute cursor-move touch-none whitespace-nowrap rounded-[2px] bg-primary/20 px-0.5 font-medium text-primary',
                        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
                        p.key === selected && 'ring-2 ring-primary',
                      )}
                    >
                      {label(p.field)}
                    </button>
                  ))}
                </BoletimSheet>
              </div>
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            {current !== null && (
              <div className="flex flex-col gap-2 rounded bg-surface-muted p-3">
                <p className="text-sm font-medium">{label(current.field)}</p>
                <div className="flex items-center gap-1">
                  <button type="button" className={ICON} onClick={() => resize(current.key, -1)} aria-label={t('boletimTemplate.smaller')}>
                    <Minus aria-hidden className="size-4" />
                  </button>
                  <span className="min-w-14 text-center text-sm tabular-nums">
                    {t('boletimTemplate.size', { size: current.sizePt })}
                  </span>
                  <button type="button" className={ICON} onClick={() => resize(current.key, 1)} aria-label={t('boletimTemplate.bigger')}>
                    <Plus aria-hidden className="size-4" />
                  </button>
                  <button type="button" className={cn(ICON, 'ml-auto')} onClick={() => drop(current.key)} aria-label={t('boletimTemplate.unplace')}>
                    <X aria-hidden className="size-4" />
                  </button>
                </div>
                <p className="text-xs text-foreground-muted">{t('boletimTemplate.keysHint')}</p>
              </div>
            )}

            {BOLETIM_FIELD_GROUPS.map((group) => (
              <fieldset key={group.key} className="flex flex-col gap-1">
                <legend className="mb-1 text-xs font-medium uppercase tracking-wider text-foreground-muted">
                  {t(`boletimTemplate.group.${group.key}`)}
                </legend>
                {group.fields.map((field) => {
                  const count = placed.filter((p) => p.field === field).length;
                  const on = armed === field;
                  return (
                    <button
                      key={field}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setArmed(on ? null : field)}
                      className={cn(
                        'flex min-h-8 items-center justify-between gap-2 rounded-sm px-2 text-left text-sm coarse:min-h-11',
                        on ? 'bg-primary text-primary-foreground' : 'hover:bg-surface-muted',
                      )}
                    >
                      <span>{label(field)}</span>
                      {count > 0 && (
                        <span className={cn('text-xs tabular-nums', !on && 'text-foreground-muted')}>
                          {t('boletimTemplate.placedCount', { count })}
                        </span>
                      )}
                    </button>
                  );
                })}
              </fieldset>
            ))}
          </div>
        </div>
      )}

      {imageUrl !== null && (
        <form action={save} className="flex flex-wrap items-center gap-3" data-bottom-bar>
          <input type="hidden" name="fields" value={JSON.stringify(plain(placed))} />
          <button type="submit" className={PRIMARY} disabled={saving || !dirty}>
            {saving ? t('common.working') : t('boletimTemplate.save')}
          </button>
          {dirty && <span className="text-sm text-foreground-muted">{t('boletimTemplate.unsaved')}</span>}
          {saveState.ok === false && saveState.errorKey !== undefined && (
            <span className="text-sm text-danger">{t(saveState.errorKey)}</span>
          )}
        </form>
      )}

      <Dialog
        open={pendingFile !== null}
        onClose={() => setPendingFile(null)}
        title={t('boletimTemplate.replaceTitle')}
        closeLabel={t('common.close')}
      >
        <p className="text-sm">{t('boletimTemplate.replaceExplain', { count: template?.fields.length ?? 0 })}</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" className={SECONDARY} onClick={() => setPendingFile(null)}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={PRIMARY}
            onClick={() => {
              const file = pendingFile;
              setPendingFile(null);
              if (file !== null) void send(file);
            }}
          >
            {t('boletimTemplate.replaceConfirm')}
          </button>
        </div>
      </Dialog>

      <Dialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        title={t('boletimTemplate.removeTitle')}
        closeLabel={t('common.close')}
      >
        <p className="text-sm">{t('boletimTemplate.removeExplain')}</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" className={SECONDARY} onClick={() => setConfirmRemove(false)}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={PRIMARY}
            onClick={() => {
              setConfirmRemove(false);
              startTransition(() => remove(undefined));
            }}
          >
            {t('boletimTemplate.removeConfirm')}
          </button>
        </div>
      </Dialog>
    </div>
  );
}
