'use client';

import { useSyncExternalStore } from 'react';
import type { GridBooking } from './api';
import type { TimetableResult } from '@/app/(app)/dashboard/calendar/import/import.actions';

/**
 * An imported timetable waiting for *Confirmar* — POOLSE-224.
 *
 * **Nothing is in the database until Confirmar**, so the preview lives here, in
 * the browser tab, and nowhere else. In memory rather than `sessionStorage` (the
 * ticket's first note): moving between Calendário and Turmas is client-side
 * navigation, so a module keeps it; and a reload or a closed tab must leave no
 * preview behind (rule 3), which session storage would have kept.
 */

/** One row the API judged, as much of it as the calendar draws. */
export interface PreviewRow {
  index: number;
  name: string;
  kind: 'turma' | 'evento' | 'free_swim';
  turmaKey: string | null;
  weekday: number;
  startMinutes: number;
  durationMinutes: number;
  laneIds: string[];
  poolId: string | null;
  instructorId: string | null;
  instructorName: string | null;
  importable: boolean;
}

export interface PreviewTurma {
  key: string;
  name: string;
  poolId: string | null;
  existingId: string | null;
  slots: number[];
}

export interface ImportPreview {
  facilityId: string;
  poolId: string;
  /** The rows exactly as sent to the API, so *Confirmar* sends the same. */
  rowsJson: string;
  drop: number[];
  rows: PreviewRow[];
  turmas: PreviewTurma[];
  fileName: string;
  /** *Substituir o calendário atual* (12-11-2026): sent again with Confirmar. */
  replace: { keepTurmaIds: string[] } | null;
  /** The pools whose current calendar is being replaced, hidden under the preview. */
  replacedPoolIds: string[];
  /** Set after a confirm: what was written, for the bar to say once. */
  done?: { created: number; turmas: number };
  /**
   * A confirm the server refused because something changed since the preview
   * (rule 2): its new verdict, for the import dialog to reopen on.
   */
  reopen?: TimetableResult;
}

/** The preview the API's answer describes, ready for the calendar. */
export function previewFrom(
  base: {
    facilityId: string;
    poolId: string;
    rowsJson: string;
    drop: number[];
    fileName: string;
    replace: { keepTurmaIds: string[] } | null;
  },
  result: TimetableResult,
): ImportPreview {
  return {
    ...base,
    replacedPoolIds: result.replacing === true ? (result.existingCalendars ?? []).map((calendar) => calendar.poolId) : [],
    rows: result.rows.map((row) => ({
      index: row.index,
      name: row.name,
      kind: row.kind,
      turmaKey: row.turmaKey,
      weekday: row.weekday,
      startMinutes: row.startMinutes,
      durationMinutes: row.durationMinutes,
      laneIds: row.laneIds,
      poolId: row.poolId,
      instructorId: row.instructorId,
      instructorName: row.instructorName,
      importable: row.importable,
    })),
    turmas: result.turmas ?? [],
  };
}

let current: ImportPreview | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function setImportPreview(next: ImportPreview | null): void {
  current = next;
  emit();
}

export function getImportPreview(): ImportPreview | null {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The preview, live: every component reading it redraws when it changes. */
export function useImportPreview(): ImportPreview | null {
  return useSyncExternalStore(subscribe, getImportPreview, () => null);
}

/** What is waiting: rows to write and turmas that are new. */
export function previewCounts(preview: ImportPreview): { classes: number; newTurmas: number } {
  const kept = preview.rows.filter((row) => row.importable && !preview.drop.includes(row.index));
  const keys = new Set(kept.map((row) => row.turmaKey));
  return {
    classes: kept.length,
    newTurmas: preview.turmas.filter((turma) => turma.existingId === null && keys.has(turma.key)).length,
  };
}

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * The preview as calendar blocks, marked `preview` — drawn in words as *por
 * confirmar*, never dragged, never opened. A turma's slot carries its planned
 * turma's name, the way the confirmed one will.
 */
export function previewBookings(preview: ImportPreview): GridBooking[] {
  const names = new Map(preview.turmas.map((turma) => [turma.key, turma.name]));
  return preview.rows
    .filter((row) => row.importable && !preview.drop.includes(row.index))
    .map((row) => ({
      id: `preview:${row.index}`,
      preview: true,
      subjectType: row.kind,
      classGroupId: null,
      name: (row.turmaKey === null ? undefined : names.get(row.turmaKey)) ?? row.name,
      subtitle: null,
      instructorId: row.instructorId,
      instructorName: row.instructorName,
      instructorStatus: 'assigned',
      headcount: null,
      categoryId: null,
      categoryName: null,
      categoryColour: null,
      classColour: null,
      partnerColour: null,
      partnerId: null,
      managedLessons: false,
      partnerGroupId: null,
      groupTag: null,
      bringsOwnInstructor: false,
      ownInstructorName: null,
      groupNotes: null,
      levelId: null,
      weekday: row.weekday,
      startTime: `${clock(row.startMinutes)}:00`,
      durationMinutes: row.durationMinutes,
      slotId: null,
      laneIds: row.laneIds,
      poolId: row.poolId,
      people: null,
      capacity: null,
      clashStudents: [],
    }));
}
