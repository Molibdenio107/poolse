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
 *
 * **Each activity also has a scope** (POOLSE-159, Rui 04-11-2026): `read`,
 * `write` or `navigate`. The kind is what the corner says; the scope is whether
 * the page is washed and stops taking clicks while it runs. Only a save and a
 * page on its way do that — a list fetch, a hover card or an export never
 * freeze the page. A save is `write` by default; a link or a server tab says
 * `navigate` itself; everything else is `read`.
 */

export type BusyKind = 'load' | 'save' | 'export';
export type BusyScope = 'read' | 'write' | 'navigate';

interface Entry {
  kind: BusyKind;
  scope: BusyScope;
  started: number;
  route: string;
}

const SLOW_MS = 1500;

let nextId = 1;
const active = new Map<number, Entry>();
const listeners = new Set<() => void>();
/** The kind the corner should name: the most recently begun of what is still running. */
let current: BusyKind | null = null;
/** Whether a save or a navigation is running — what washes the page. */
let blocking = false;

function publish(): void {
  const entries = [...active.values()];
  const next = entries.at(-1)?.kind ?? null;
  const nextBlocking = entries.some((entry) => entry.scope !== 'read');
  if (next === current && nextBlocking === blocking) return;
  current = next;
  blocking = nextBlocking;
  for (const listener of listeners) listener();
}

/** A save writes; anything else reads unless its caller says it navigates. */
function defaultScope(kind: BusyKind): BusyScope {
  return kind === 'save' ? 'write' : 'read';
}

export function beginBusy(kind: BusyKind, scope: BusyScope = defaultScope(kind)): number {
  const id = nextId++;
  active.set(id, {
    kind,
    scope,
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
export async function trackBusy<T>(
  kind: BusyKind,
  work: () => Promise<T>,
  scope: BusyScope = defaultScope(kind),
): Promise<T> {
  const id = beginBusy(kind, scope);
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
export function useBusyWhile(busy: boolean, kind: BusyKind, scope: BusyScope = defaultScope(kind)): void {
  useEffect(() => {
    if (!busy) return;
    const id = beginBusy(kind, scope);
    return () => endBusy(id);
  }, [busy, kind, scope]);
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

/** Whether a save or a navigation is running — the snapshot the wash reads, and the tests. */
export function currentBlocking(): boolean {
  return blocking;
}

/** Whether the page should be washed — POOLSE-159. */
export function useBlocking(): boolean {
  return useSyncExternalStore(subscribe, currentBlocking, () => false);
}
