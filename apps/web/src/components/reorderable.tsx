'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { GripVertical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/**
 * A list you can drag into a new order — POOLSE-05.
 *
 * **Pointer events, not HTML5 drag and drop.** The ticket asks for touch to work
 * ("long-press to grab, for tablet use"), and native `dragstart` simply does not
 * fire on touch. Pointer events cover mouse, pen and finger with one code path,
 * which is also one behaviour to get right rather than two to keep in step.
 *
 * **The keyboard path is not a consolation prize.** Removing the up/down arrows
 * removes the only way somebody without a pointer could reorder anything, so the
 * grip is a real button: Space or Enter picks the row up, the arrow keys move it,
 * Space or Enter puts it down, Escape puts it back where it was. That is the
 * standard grab-move-drop pattern, and it is announced rather than left to be
 * discovered.
 *
 * **Optimistic, with a real rollback.** The list reorders under the pointer
 * immediately and the save happens after. If the save fails the previous order is
 * put back and the caller is told — a list that silently kept a change the server
 * rejected is worse than one that never moved.
 */
export interface ReorderableItem {
  id: string;
  /** Named in the grip's accessible label — "Mover Nível A". */
  label: string;
}

export function Reorderable<T extends ReorderableItem>({
  items,
  onReorder,
  children,
  as = 'list',
  columns,
  className,
}: {
  items: T[];
  /** Given the new order. Rejecting rolls the list back. */
  onReorder: (ids: string[]) => Promise<void>;
  children: (item: T, index: number) => React.ReactNode;
  /**
   * Render as table rows instead of list items — POOLSE-40.
   *
   * A skills table needs `<tr>`, and the alternative was a second drag
   * implementation for it. One state machine, two shapes: `children` then
   * supplies `<td>`s rather than free-form content, and the grip and the
   * position number get cells of their own.
   */
  as?: 'list' | 'rows';
  /** Column count, so the "no rows" case can span the table properly. */
  columns?: number;
  className?: string;
}): React.ReactElement {
  const t = useTranslations();

  const [order, setOrder] = useState<T[]>(items);
  const [dragging, setDragging] = useState<string | null>(null);
  const [grabbed, setGrabbed] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // Where a keyboard grab started, so Escape can put the row back exactly.
  const before = useRef<T[] | null>(null);
  // `HTMLElement`, because a row is an `<li>` in one shape and a `<tr>` in the
  // other — POOLSE-40. Only `querySelector` and `focus` are used on it.
  const rows = useRef(new Map<string, HTMLElement>());

  /*
   * Re-seeded when the server's list actually changes — a rename, an archive, a
   * new level. Compared by id sequence rather than by reference, because the
   * page re-renders on every revalidate and a plain dependency would throw away
   * a drag in progress.
   */
  const signature = items.map((item) => item.id).join(',');
  const seeded = useRef(signature);
  useEffect(() => {
    if (seeded.current === signature) return;
    seeded.current = signature;
    setOrder(items);
  }, [signature, items]);

  const commit = useCallback(
    (next: T[]) => {
      const previous = order;
      setOrder(next);
      setFailed(false);

      void onReorder(next.map((item) => item.id)).catch(() => {
        // Rolled back, and said out loud. A list that quietly kept an order the
        // server refused would disagree with every other screen.
        setOrder(previous);
        setFailed(true);
      });
    },
    [order, onReorder],
  );

  function move(id: string, to: number): T[] {
    const from = order.findIndex((item) => item.id === id);
    if (from === -1) return order;

    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(Math.max(0, Math.min(next.length, to)), 0, moved!);
    return next;
  }

  /** Which row the pointer is over, by comparing against each row's midpoint. */
  function indexAt(clientY: number): number {
    let index = order.length;
    for (const [id, element] of rows.current) {
      const box = element.getBoundingClientRect();
      if (clientY < box.top + box.height / 2) {
        index = Math.min(index, order.findIndex((item) => item.id === id));
      }
    }
    return index === -1 ? order.length : index;
  }

  function onGripPointerDown(event: React.PointerEvent, id: string): void {
    // Primary button or a finger. A right-click must not start a drag.
    if (event.button !== 0) return;
    event.preventDefault();
    (event.target as Element).setPointerCapture(event.pointerId);
    setDragging(id);
    before.current = order;
  }

  function onGripPointerMove(event: React.PointerEvent, id: string): void {
    if (dragging !== id) return;
    event.preventDefault();

    const target = indexAt(event.clientY);
    const current = order.findIndex((item) => item.id === id);
    if (target === current || target === current + 1) return;

    setOrder(move(id, target > current ? target - 1 : target));
  }

  function onGripPointerUp(event: React.PointerEvent, id: string): void {
    if (dragging !== id) return;
    (event.target as Element).releasePointerCapture(event.pointerId);
    setDragging(null);

    const started = before.current;
    before.current = null;
    if (started === null) return;

    // Only save if something actually moved. A click on the grip is not a
    // reorder, and sending one would be a write nobody asked for.
    if (started.map((item) => item.id).join(',') !== order.map((item) => item.id).join(',')) {
      const next = order;
      setOrder(started);
      commit(next);
    }
  }

  function onGripKeyDown(event: React.KeyboardEvent, id: string): void {
    const index = order.findIndex((item) => item.id === id);

    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (grabbed === id) {
        setGrabbed(null);
        const started = before.current;
        before.current = null;
        if (
          started !== null &&
          started.map((item) => item.id).join(',') !== order.map((item) => item.id).join(',')
        ) {
          const next = order;
          setOrder(started);
          commit(next);
        }
      } else {
        setGrabbed(id);
        before.current = order;
      }
      return;
    }

    if (event.key === 'Escape' && grabbed === id) {
      event.preventDefault();
      setGrabbed(null);
      if (before.current !== null) setOrder(before.current);
      before.current = null;
      return;
    }

    if (grabbed !== id) return;

    if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault();
      setOrder(move(id, index - 1));
      // Focus follows the row, or the next arrow press lands on whoever moved
      // into the space instead.
      queueMicrotask(() => rows.current.get(id)?.querySelector('button')?.focus());
    }
    if (event.key === 'ArrowDown' && index < order.length - 1) {
      event.preventDefault();
      setOrder(move(id, index + 1));
      queueMicrotask(() => rows.current.get(id)?.querySelector('button')?.focus());
    }
  }

  /*
   * The grip, identical in both shapes.
   *
   * Every drag handler lives on this button and nowhere else, which is what
   * makes nesting one of these inside another safe: an inner grip is not an
   * ancestor of an outer grip, so its events cannot reach it. A skill row can
   * never pick up the level card it sits in — POOLSE-40 AC7 and AC8.
   */
  const grip = (item: T): React.ReactElement => (
    <button
      type="button"
      // `touch-none` stops the page scrolling under a finger that is dragging a
      // row, which otherwise makes touch reordering unusable.
      className="cursor-grab touch-none rounded p-1 text-foreground-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:cursor-grabbing"
      aria-label={t('common.reorderGrip', { name: item.label })}
      aria-pressed={grabbed === item.id}
      aria-describedby="reorder-help"
      onPointerDown={(event) => onGripPointerDown(event, item.id)}
      onPointerMove={(event) => onGripPointerMove(event, item.id)}
      onPointerUp={(event) => onGripPointerUp(event, item.id)}
      onKeyDown={(event) => onGripKeyDown(event, item.id)}
    >
      <GripVertical className="size-4" aria-hidden />
    </button>
  );

  const moving = (item: T): boolean => dragging === item.id || grabbed === item.id;

  if (as === 'rows') {
    return (
      <>
        <tbody>
          {order.map((item, index) => (
            <tr
              key={item.id}
              ref={(element) => {
                if (element) rows.current.set(item.id as string, element as never);
                else rows.current.delete(item.id);
              }}
              className={cn(
                'border-b border-border transition-colors last:border-0',
                moving(item) ? 'bg-primary/10 ring-1 ring-primary' : 'hover:bg-surface-muted',
              )}
            >
              <td className="w-10 px-2 py-2 align-middle">{grip(item)}</td>
              <td className="w-8 px-1 py-2 text-right align-middle text-foreground-muted tabular-nums">
                {index + 1}
              </td>
              {children(item, index)}
            </tr>
          ))}
        </tbody>

        {/* Outside the table: a <p> is not valid inside one. */}
        <tfoot>
          <tr>
            <td colSpan={columns ?? 6} className="px-2 pt-2">
              <span id="reorder-help" className="text-sm text-foreground-muted">
                {t('common.reorderHelp')}
              </span>
              {failed && (
                <span className="ml-3 text-sm text-danger">{t('common.reorderFailed')}</span>
              )}
            </td>
          </tr>
        </tfoot>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className={cn('flex flex-col divide-y divide-border', className)}>
        {order.map((item, index) => (
          <li
            key={item.id}
            ref={(element) => {
              if (element) rows.current.set(item.id, element);
              else rows.current.delete(item.id);
            }}
            className={cn(
              'flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0 transition-colors',
              // The drop indicator: the row being moved lifts off the surface, so
              // there is never any doubt about which one is travelling.
              moving(item) && 'rounded bg-primary/10 ring-1 ring-primary',
            )}
          >
            {grip(item)}

            <span className="text-sm text-foreground-muted">{index + 1}.</span>

            {children(item, index)}
          </li>
        ))}
      </ul>

      {/* Said once for the whole list rather than on every grip. */}
      <p id="reorder-help" className="text-sm text-foreground-muted">
        {t('common.reorderHelp')}
      </p>

      {failed && <p className="text-sm text-danger">{t('common.reorderFailed')}</p>}

      {/*
        Announced to a screen reader as the order changes, because a visual drop
        indicator says nothing to somebody listening.
      */}
      <p aria-live="polite" className="sr-only">
        {grabbed !== null
          ? t('common.reorderGrabbed', {
              name: order.find((item) => item.id === grabbed)?.label ?? '',
              position: order.findIndex((item) => item.id === grabbed) + 1,
              total: order.length,
            })
          : ''}
      </p>
    </div>
  );
}
