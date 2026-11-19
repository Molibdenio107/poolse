'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { MENU_BUTTON, TOURS, tourShellFor, type TourShell } from '@/lib/tours';
import { START_TOUR_EVENT, TOUR_PARAM } from './start-tour-button';
import { recordTourAction } from './tour.actions';

interface Resolved {
  id: string;
  element: HTMLElement;
  /** Pointing at the phone's menu button instead of an entry hidden behind it. */
  viaMenu: boolean;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const GAP = 10;
const CARD_WIDTH = 320;

function visible(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  return getComputedStyle(element).visibility !== 'hidden';
}

/** The first match of each step that is on screen; a step with none is skipped. */
function resolve(shell: TourShell): Resolved[] {
  const menu = shell === 'backoffice' ? document.querySelector(MENU_BUTTON) : null;
  const found: Resolved[] = [];
  for (const step of TOURS[shell]) {
    let element: HTMLElement | null = null;
    for (const selector of step.selectors) {
      const match = Array.from(document.querySelectorAll(selector)).find(visible);
      if (match !== undefined) {
        element = match as HTMLElement;
        break;
      }
    }
    if (element !== null) found.push({ id: step.id, element, viaMenu: false });
    else if (visible(menu) && (step.inMenu === true || step.selectors.some((selector) => document.querySelector(selector) !== null))) {
      // Below `md` the entry sits behind the menu (a sport's tab is not even drawn
      // until the menu opens): point at the button, and the card names the entry.
      found.push({ id: step.id, element: menu, viaMenu: true });
    }
  }
  return found;
}

/**
 * The guided tour — POOLSE-230 (Rui, 19-11-2026). In-house coach marks, no
 * dependency: a ring round one menu entry with the page dimmed around it, and a
 * small card beside it. Mounted once per shell; it never starts on its own, only
 * on `START_TOUR_EVENT` (*Vamos começar*, Perfil → *Rever visita guiada*, Ctrl+K).
 *
 * Keyboard: focus moves into the card and stays there (Tab cycles its buttons),
 * the arrows move between steps, Escape closes, and focus goes back to whatever
 * started it. It is a labelled `role="dialog"`. Under reduced motion nothing
 * glides. *Concluir* and *Fechar* record the outcome for this person in this club.
 */
export function GuidedTour(): React.ReactElement | null {
  const t = useTranslations();
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const home = params.get('home');
  const asked = params.get(TOUR_PARAM) === '1';
  const shell = tourShellFor(pathname, home);

  const [steps, setSteps] = useState<Resolved[] | null>(null);
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const start = useCallback(() => {
    const found = resolve(shell);
    if (found.length === 0) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setIndex(0);
    setSteps(found);
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
      setSteps(null);
      setBox(null);
      void recordTourAction(outcome);
      opener.current?.focus();
    },
    [],
  );

  const current = steps?.[index] ?? null;

  // Follow the entry as the window scrolls or resizes.
  useLayoutEffect(() => {
    if (current === null) return;
    const measure = (): void => {
      const rect = current.element.getBoundingClientRect();
      setBox({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
    };
    current.element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [current]);

  // Each step puts the focus on its main button, once the card is drawn (the
  // card waits for the entry's measurements, one render after the step).
  const drawn = box !== null;
  useEffect(() => {
    if (current === null || !drawn) return;
    card.current?.querySelector<HTMLButtonElement>('[data-tour-primary]')?.focus();
  }, [current, drawn]);

  const last = steps !== null && index === steps.length - 1;
  const next = (): void => (last ? close('finished') : setIndex(index + 1));
  const previous = (): void => setIndex(Math.max(0, index - 1));

  /*
   * The keys, on the window while the tour is open — whatever has the focus, the
   * tour owns Escape, the arrows and Tab, and Tab is brought back into the card.
   * Through a ref, so the listener is added once and always sees this step.
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
  const open = steps !== null;
  useEffect(() => {
    if (!open) return;
    const listener = (event: KeyboardEvent): void => onKey.current(event);
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, [open]);

  if (steps === null || current === null || box === null) return null;

  // Below the entry when there is room, above it otherwise (the phone's tab bar).
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(CARD_WIDTH, viewportWidth - 32);
  const below = box.top + box.height + GAP + 220 < viewportHeight;
  const sideways = box.width < 260 && box.left + box.width + GAP + width < viewportWidth && !below;
  const left = sideways
    ? box.left + box.width + GAP
    : Math.min(Math.max(16, box.left), viewportWidth - width - 16);
  const position: React.CSSProperties = sideways
    ? { left, top: Math.max(16, box.top) }
    : below
      ? { left, top: box.top + box.height + GAP }
      : { left, bottom: viewportHeight - box.top + GAP };

  const title = t(`tour.${shell}.${current.id}.title` as never);

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
        className="fixed flex flex-col gap-3 rounded bg-surface p-4 text-foreground shadow-card motion-safe:transition-all motion-safe:duration-300"
        style={{ ...position, width }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <p className="text-xs text-foreground-muted">{t('tour.progress', { n: index + 1, total: steps.length })}</p>
            <h2 id="tour-title" className="text-base font-semibold">
              {title}
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
        <p id="tour-body" className="text-sm">
          {t(`tour.${shell}.${current.id}.body` as never)}
          {current.viaMenu && <> {t('tour.viaMenu')}</>}
        </p>
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
