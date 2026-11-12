'use client';

import { useImportPreview } from '@/lib/import-preview';

/**
 * The empty calendar gives way to an import waiting for *Confirmar* — POOLSE-224.
 *
 * Whether the club has classes is the server's answer; whether an import is
 * waiting is this tab's. A club importing its first timetable has none, so the
 * page renders both the next-step card and the grid, and this shows the grid
 * while a preview waits for this site, the card otherwise. `always` is the grid
 * of a club that has classes, which never depends on a preview.
 */
export function ImportGate({
  show,
  facilityId,
  children,
}: {
  show: 'always' | 'waiting' | 'notWaiting';
  facilityId: string | null;
  children: React.ReactNode;
}): React.ReactElement | null {
  const preview = useImportPreview();
  if (show === 'always') return <>{children}</>;
  const waiting = preview !== null && preview.done === undefined && preview.facilityId === facilityId;
  return (show === 'waiting') === waiting ? <>{children}</> : null;
}
