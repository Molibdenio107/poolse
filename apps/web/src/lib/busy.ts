'use client';

import { useEffect, useSyncExternalStore } from 'react';

/**
 * Something is happening — POOLSE-98 (Rui, 22-10-2026).
 *
 * One store for every slow thing the app starts: a page loading, a form
 * saving, a file being exported. Each `begin` returns an id and its `end` names
 * that id, so two things at once count as two and the corner says so until both
 * are done — a counter would end early the day one of them ended twice.
 *
 * The store knows nothing about time. Whether the corner shows at all (only past
 * 400 ms) and for how long (at least 300 ms) is `BusyIndicator`'s rule; this
 * is only who is busy, and with what.
 *
 * **In development, anything over 1.5 s is logged** with its kind and route —
 * the list of candidates to make faster, which this ticket was asked to keep and
 * not to act on.
 */

export type BusyKind = 'load' | 'save' | 'export';

interface Entry {
  kind: BusyKind;
  started: number;
  route: string;
}

const SLOW_MS = 1500;

let nextId = 1;
const active = new Map<number, Entry>();
const listeners = new Set<() => void>();
/** The kind the corner should name: the most recently begun of what is still running. */
let current: BusyKind | null = null;

function publish(): void {
  const latest = [...active.values()].at(-1);
  const next = latest?.kind ?? null;
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

export function beginBusy(kind: BusyKind): number {
  const id = nextId++;
  active.set(id, {
    kind,
    started: performance.now(),
    route: typeof window === 'undefined' ? '' : window.location.pathname,
  });
  publish();
  return id;
}

export function endBusy(id: number): void {
  const entry = active.get(id);
  if (entry === undefined) return;
  active.delete(id);
  const took = performance.now() - entry.started;
  if (process.env.NODE_ENV !== 'production' && took > SLOW_MS) {
    console.info(`[poolse:slow] ${entry.kind} took ${Math.round(took)} ms on ${entry.route}`);
  }
  publish();
}

/** Runs `work` as one activity, ended however it ends. */
export async function trackBusy<T>(kind: BusyKind, work: () => Promise<T>): Promise<T> {
  const id = beginBusy(kind);
  try {
    return await work();
  } finally {
    endBusy(id);
  }
}

/**
 * An activity for as long as `busy` is true — what a hook with a pending flag
 * (`useActionState`, `useTransition`, `useLinkStatus`) hands over.
 */
export function useBusyWhile(busy: boolean, kind: BusyKind): void {
  useEffect(() => {
    if (!busy) return;
    const id = beginBusy(kind);
    return () => endBusy(id);
  }, [busy, kind]);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** What is running now, or null — the snapshot the corner reads, and the tests. */
export function currentBusy(): BusyKind | null {
  return current;
}

/** What is running now, or null — for the corner. */
export function useCurrentBusy(): BusyKind | null {
  return useSyncExternalStore(subscribe, currentBusy, () => null);
}
