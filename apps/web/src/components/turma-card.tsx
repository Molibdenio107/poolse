'use client';

import * as HoverCardPrimitive from '@radix-ui/react-hover-card';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/**
 * The full turma, on hover — POOLSE-15.
 *
 * The week grid gives each slot about a seventh of the screen, so a turma of
 * twenty shows eight names and a "+12 mais" (POOLSE-08). This is where the other
 * twelve live: hovering or keyboard-focusing the slot opens a panel with the
 * whole list and the detail the column has no room for.
 *
 * **No request is made.** The names are already in the page — the grid receives
 * the full list and slices it only at render — so the panel reads what is
 * already there. The ticket asks for "fetched once and cached per turma, not a
 * request per pixel of movement"; not fetching at all satisfies that and there
 * is nothing to invalidate.
 *
 * **Radix rather than a hover div**, for the same reason as the tooltip: it
 * handles the open delay, the flip near a viewport edge, dismissal on Escape,
 * staying open while the cursor is inside, and — the one that matters most here
 * — opening on keyboard focus. A panel that only a mouse can reach is a panel
 * half the users cannot read, which is the line CLAUDE.md draws.
 *
 * **Touch devices get nothing, deliberately** (criterion 7). There is no hover on
 * a finger, and the usual workaround — open on tap — steals the tap from the
 * link, so the panel becomes a thing you must dismiss before you can open the
 * turma. `onTouchStart` preventing the open leaves tap meaning what it means
 * everywhere else in the app: go to the turma, where all of this is plain text.
 *
 * This panel is a shortcut, never the only route. Everything in it is on the
 * turma's own page — which is what makes an information-bearing hover allowable
 * at all.
 */

/** ~300 ms, per the ticket: long enough that crossing the grid does not flicker. */
const OPEN_DELAY = 300;

/** Short, so moving between two slots does not feel sticky. */
const CLOSE_DELAY = 120;

export interface TurmaDetail {
  /** Translated label/value pairs — level, instructor, day and time, pool and lane. */
  facts: { label: string; value: string }[];
  /** "9/12", already formatted. Shown prominently because it is the number people look for. */
  occupancy?: string | undefined;
  /** Every enrolled student, in full. No truncation — that is the point. */
  people: string[];
  /** Shown instead of the list when nobody is enrolled. */
  peopleEmpty?: string | undefined;
}

export function TurmaHoverCard({
  title,
  detail,
  children,
}: {
  title: string;
  detail: TurmaDetail;
  children: React.ReactNode;
}): React.ReactElement {
  const t = useTranslations();

  return (
    <HoverCardPrimitive.Root openDelay={OPEN_DELAY} closeDelay={CLOSE_DELAY}>
      {/*
        `asChild` so the trigger stays the slot's own element — an anchor stays an
        anchor and keeps its href, rather than being wrapped in a button that
        would swallow the click and break keyboard navigation to the turma.
      */}
      <HoverCardPrimitive.Trigger asChild onTouchStart={(event) => event.preventDefault()}>
        {children}
      </HoverCardPrimitive.Trigger>

      <HoverCardPrimitive.Portal>
        <HoverCardPrimitive.Content
          side="right"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          avoidCollisions
          className={cn(
            'z-50 w-72 rounded border border-border bg-surface p-4 shadow-lg',
            // Never taller than the viewport, and scrollable when the list is
            // long — a thirty-name turma must not run off the bottom of the
            // screen with no way to reach the end of it.
            'max-h-[min(28rem,calc(100vh-2rem))] overflow-y-auto overscroll-contain',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          )}
        >
          <p className="font-medium">{title}</p>

          {detail.occupancy !== undefined && (
            <p className="mt-0.5 text-sm text-foreground-muted">
              {t('classes.occupancy', { occupancy: detail.occupancy })}
            </p>
          )}

          {detail.facts.length > 0 && (
            <dl className="mt-3 flex flex-col gap-1 text-sm">
              {detail.facts.map((fact) => (
                <div key={fact.label} className="flex gap-2">
                  <dt className="shrink-0 text-foreground-muted">{fact.label}</dt>
                  <dd className="break-words">{fact.value}</dd>
                </div>
              ))}
            </dl>
          )}

          <div className="mt-3 border-t border-border pt-3">
            {detail.people.length === 0 ? (
              <p className="text-sm text-foreground-muted">
                {detail.peopleEmpty ?? t('classes.noStudents')}
              </p>
            ) : (
              <>
                <p className="mb-1 text-sm font-medium text-foreground-muted">
                  {t('classes.enrolled')}
                </p>
                {/*
                  The whole list, uncut. The grid's "+12 mais" exists because a
                  column is narrow; this panel is not, and cutting here would
                  leave the twelve unreachable without opening the turma — which
                  is the problem the ticket is about.
                */}
                <ul className="flex list-inside list-disc flex-col gap-0.5 text-sm">
                  {detail.people.map((person) => (
                    <li key={person} className="break-words">
                      {person}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </HoverCardPrimitive.Content>
      </HoverCardPrimitive.Portal>
    </HoverCardPrimitive.Root>
  );
}
