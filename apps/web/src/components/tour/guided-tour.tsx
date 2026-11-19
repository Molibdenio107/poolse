'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Lightbulb, X } from 'lucide-react';
import { MENU_BUTTON, TOURS, tourShellFor, type TourShell, type TourStep } from '@/lib/tours';
import { START_TOUR_EVENT, TOUR_PARAM } from './start-tour-button';
import { recordTourAction } from './tour.actions';

/** How a step finds its target: on this page, after opening `via`, or behind the phone's menu. */
type Mode = 'here' | 'via' | 'menu';

interface Planned {
  step: TourStep;
  mode: Mode;
}

interface Target {
  element: HTMLElement;
  viaMenu: boolean;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const GAP = 10;
const CARD_WIDTH = 340;
/** How long a step that opened another page waits for its entry to be drawn. */
const VIA_WAIT_MS = 6000;

function visible(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  return getComputedStyle(element).visibility !== 'hidden';
}

function findOnScreen(step: TourStep): HTMLElement | null {
  for (const selector of step.selectors) {
    const match = Array.from(document.querySelectorAll(selector)).find(visible);
    if (match !== undefined) return match as HTMLElement;
  }
  return null;
}

/** Which steps this tour has, decided as it starts; a step with no way to its target is skipped. */
function plan(shell: TourShell): Planned[] {
  const menu = shell === 'backoffice' ? document.querySelector(MENU_BUTTON) : null;
  const planned: Planned[] = [];
  for (const step of TOURS[shell]) {
    if (findOnScreen(step) !== null) planned.push({ step, mode: 'here' });
    else if (step.via !== undefined && visible(document.querySelector(step.via))) planned.push({ step, mode: 'via' });
    else if (
      visible(menu) &&
      (step.inMenu === true || step.selectors.some((selector) => document.querySelector(selector) !== null))
    ) {
      // Below `md` the entry sits behind the menu (a sport's entries are not even
      // drawn until it opens): point at the button, and the card names the entry.
      planned.push({ step, mode: 'menu' });
    }
  }
  return planned;
}

/**
 * The guided tour — POOLSE-230 (Rui, 19-11-2026). In-house coach marks, no
 * dependency: a ring round one menu entry or control with the page dimmed
 * around it, and a card beside it with what the area is for and two or three
 * tips. Mounted once per shell; it never starts on its own, only on
 * `START_TOUR_EVENT` (*Vamos começar*, *Rever visita guiada*, Ctrl+K) or the
 * `?tour=1` a *Rever visita guiada* elsewhere opened the home with.
 *
 * A step inside the sport's section (Calendário, Turmas, Piscinas) opens that
 * section first and waits for its entry; *Concluir* goes back to where the tour
 * started. Keyboard: focus moves into the card and stays there, the arrows move
 * between steps, Escape closes, focus goes back to whatever started it. A
 * labelled `role="dialog"`; nothing glides under reduced motion.
 */
export function GuidedTour(): React.ReactElement | null {
  const t = useTranslations();
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const home = params.get('home');
  const asked = params.get(TOUR_PARAM) === '1';
  const shell = tourShellFor(pathname, home);

  const [tour, setTour] = useState<{ shell: TourShell; steps: Planned[]; from: string } | null>(null);
  const [index, setIndex] = useState(0);
  const [target, setTarget] = useState<Target | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const here = useRef(pathname);
  here.current = params.toString() === '' ? pathname : `${pathname}?${params.toString()}`;

  const start = useCallback(() => {
    const steps = plan(shell);
    if (steps.length === 0) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setIndex(0);
    setTarget(null);
    setBox(null);
    setTour({ shell, steps, from: here.current });
  }, [shell]);

  useEffect(() => {
    window.addEventListener(START_TOUR_EVENT, start);
    return () => window.removeEventListener(START_TOUR_EVENT, start);
  }, [start]);

  // Asked for from a page with no menu (`?tour=1`, a person's tap): start once the
  // tabs are drawn, and take the flag off the address so a reload does not replay it.
  useEffect(() => {
    if (!asked) return;
    const timer = window.setTimeout(() => {
      start();
      const rest = new URLSearchParams(params.toString());
      rest.delete(TOUR_PARAM);
      const query = rest.toString();
      router.replace(query === '' ? pathname : `${pathname}?${query}`, { scroll: false });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [asked, start, params, pathname, router]);

  const close = useCallback(
    (outcome: 'finished' | 'dismissed') => {
      const from = tour?.from;
      setTour(null);
      setTarget(null);
      setBox(null);
      void recordTourAction(outcome);
      // A tour that moved into the sport's section goes back where it began.
      if (from !== undefined && from !== here.current) router.push(from);
      else opener.current?.focus();
    },
    [tour, router],
  );

  const planned = tour?.steps[index] ?? null;

  // Find this step's target, opening the sport's section first when it lives there.
  useEffect(() => {
    if (planned === null) return;
    setTarget(null);
    setBox(null);
    const { step, mode } = planned;
    if (mode === 'menu') {
      const menu = document.querySelector(MENU_BUTTON);
      if (visible(menu)) setTarget({ element: menu, viaMenu: true });
      return;
    }
    const found = findOnScreen(step);
    if (found !== null) {
      setTarget({ element: found, viaMenu: false });
      return;
    }
    if (step.via !== undefined) {
      const link = document.querySelector<HTMLAnchorElement>(step.via);
      const href = link?.getAttribute('href');
      if (href) router.push(href);
    } else if (tour !== null && tour.from !== here.current) {
      // *Anterior* from the sport's section to a step on the page the tour began on.
      router.push(tour.from);
    }
    // Wait for the entry to be drawn; past the wait, the step is passed over.
    const started = Date.now();
    const timer = window.setInterval(() => {
      const late = findOnScreen(step);
      if (late !== null) {
        window.clearInterval(timer);
        setTarget({ element: late, viaMenu: false });
      } else if (Date.now() - started > VIA_WAIT_MS) {
        window.clearInterval(timer);
        setIndex((at) => at + 1);
      }
    }, 150);
    return () => window.clearInterval(timer);
    // `tour` is read for where it began, which does not change while it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planned, router]);

  // A step passed over at the very end closes the tour.
  useEffect(() => {
    if (tour !== null && index >= tour.steps.length) close('finished');
  }, [tour, index, close]);

  // Follow the target as the window scrolls or resizes.
  useLayoutEffect(() => {
    if (target === null) return;
    const measure = (): void => {
      if (!target.element.isConnected) return;
      const rect = target.element.getBoundingClientRect();
      setBox({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
    };
    target.element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [target]);

  // Each step puts the focus on its main button, once the card is drawn.
  const drawn = box !== null;
  useEffect(() => {
    if (!drawn) return;
    card.current?.querySelector<HTMLButtonElement>('[data-tour-primary]')?.focus();
  }, [drawn, index]);

  const total = tour?.steps.length ?? 0;
  const last = index === total - 1;
  const next = (): void => (last ? close('finished') : setIndex(index + 1));
  const previous = (): void => setIndex(Math.max(0, index - 1));

  /*
   * The keys, on the window while the tour is open: whatever has the focus, the
   * tour owns Escape, the arrows and Tab, and Tab is brought back into the card.
   */
  const onKey = useRef<(event: KeyboardEvent) => void>(() => undefined);
  onKey.current = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close('dismissed');
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      next();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      previous();
    } else if (event.key === 'Tab') {
      const buttons = Array.from(card.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
      if (buttons.length === 0) return;
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      event.preventDefault();
      const to = event.shiftKey ? (at <= 0 ? buttons.length - 1 : at - 1) : at === buttons.length - 1 ? 0 : at + 1;
      buttons[to]?.focus();
    }
  };
  const open = tour !== null;
  useEffect(() => {
    if (!open) return;
    const listener = (event: KeyboardEvent): void => onKey.current(event);
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, [open]);

  if (tour === null || planned === null || target === null || box === null) return null;

  // Below the target when there is room, beside a narrow one, above otherwise (the phone's tab bar).
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(CARD_WIDTH, viewportWidth - 32);
  const below = box.top + box.height + GAP + 300 < viewportHeight;
  const sideways = box.width < 260 && box.left + box.width + GAP + width < viewportWidth && !below;
  const left = sideways ? box.left + box.width + GAP : Math.min(Math.max(16, box.left), viewportWidth - width - 16);
  const position: React.CSSProperties = sideways
    ? { left, top: Math.max(16, Math.min(box.top, viewportHeight - 340)) }
    : below
      ? { left, top: box.top + box.height + GAP }
      : { left, bottom: viewportHeight - box.top + GAP };

  const key = `tour.${tour.shell}.${planned.step.id}`;
  const tips = Array.from({ length: planned.step.tips }, (_, at) => t(`${key}.tip${at + 1}` as never));

  return createPortal(
    <div className="fixed inset-0 z-[60]">
      {/* Clicks on the dimmed page do nothing: the card is the only way on. */}
      <div className="absolute inset-0" aria-hidden />
      <div
        aria-hidden
        className="pointer-events-none fixed rounded ring-2 ring-primary motion-safe:transition-all motion-safe:duration-300"
        style={{
          top: box.top - 4,
          left: box.left - 4,
          width: box.width + 8,
          height: box.height + 8,
          boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.4)',
        }}
      />
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className="fixed flex max-h-[calc(100dvh-2rem)] flex-col gap-3 overflow-y-auto rounded bg-surface p-4 text-foreground shadow-card motion-safe:transition-all motion-safe:duration-300"
        style={{ ...position, width }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <p className="text-xs text-foreground-muted">{t('tour.progress', { n: index + 1, total })}</p>
            <h2 id="tour-title" className="text-base font-semibold">
              {t(`${key}.title` as never)}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => close('dismissed')}
            aria-label={t('tour.close')}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-foreground-muted hover:bg-surface-muted hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <div id="tour-body" className="flex flex-col gap-2 text-sm">
          <p>
            {t(`${key}.body` as never)}
            {target.viaMenu && <> {t('tour.viaMenu')}</>}
          </p>
          {tips.length > 0 && (
            <div className="flex flex-col gap-1 rounded-sm bg-surface-muted p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-foreground-muted">
                <Lightbulb className="size-3.5" aria-hidden />
                {t('tour.tipsTitle')}
              </p>
              <ul className="flex list-disc flex-col gap-1 pl-5">
                {tips.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={previous}
            disabled={index === 0}
            className="inline-flex h-control items-center justify-center rounded-sm px-3 text-control text-foreground-muted hover:text-foreground disabled:invisible"
          >
            {t('tour.previous')}
          </button>
          <button
            type="button"
            data-tour-primary
            onClick={next}
            className="inline-flex h-control items-center justify-center rounded-sm bg-primary px-5 text-control font-semibold text-primary-foreground"
          >
            {last ? t('tour.finish') : t('tour.next')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
