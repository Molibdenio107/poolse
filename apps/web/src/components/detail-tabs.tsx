'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
} from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { resolveTab, tabHref, type TabBadge } from '@/lib/detail-tabs';
import { cn } from '@/lib/utils';

/**
 * The client half of a tabbed detail page. `DetailPage` is the server half and
 * the only caller; read that first.
 *
 * Three jobs live here, all of them things a server component cannot do:
 *
 * - **The tab is the URL.** Choosing one is a `router.push` to `?tab=<slug>`,
 *   so refresh, a shared link and the back button all land where somebody was.
 *   The server then renders that tab and only that tab — the lazy loading is
 *   the server not fetching what nobody opened, not a client cache.
 * - **Unsaved changes are noticed.** Typing into any form inside the panel
 *   marks it dirty; a fresh payload from the server — which is what every save
 *   here ends in, through `revalidatePath` — marks it clean. Leaving with it
 *   dirty asks first, whether the way out is another tab, an in-app link, or
 *   closing the window.
 * - **Cancel discards.** The panel's content is remounted, which re-seeds every
 *   controlled field from what the server last sent. No form has to know.
 *
 * **Eager pages** (`panels` set) are the exception to the first point: every
 * tab arrived with the page, and switching is `history.pushState`, which Next
 * keeps in step with `useSearchParams` without asking the server for anything.
 * The URL, refresh and the back button behave the same; nothing is refetched.
 */

export interface DetailTab {
  slug: string;
  labelKey: string;
  badge?: TabBadge | undefined;
}

interface TabsState {
  tabs: DetailTab[];
  value: string;
  pending: boolean;
  dirty: boolean;
  setDirty: (dirty: boolean) => void;
  resetKey: number;
  discard: () => void;
  choose: (slug: string) => void;
  panels: Record<string, React.ReactNode> | undefined;
}

const TabsContext = createContext<TabsState | null>(null);

function useTabs(): TabsState {
  const state = useContext(TabsContext);
  if (state === null) throw new Error('DetailTabs parts must render inside <DetailTabs>');
  return state;
}

export function DetailTabs({
  tabs,
  active: rendered,
  panels,
  children,
}: {
  tabs: DetailTab[];
  /** The tab the server rendered. */
  active: string;
  /** Every tab's content, for an eager page; absent when only `active` was rendered. */
  panels?: Record<string, React.ReactNode> | undefined;
  children: React.ReactNode;
}): React.ReactElement {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [chosen, setChosen] = useState(rendered);
  const [dirty, setDirty] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [leaving, setLeaving] = useState<(() => void) | null>(null);

  // An eager page reads the tab from the URL itself — the server rendered them
  // all and is not asked again, so `rendered` stops changing after the load.
  const active =
    panels === undefined
      ? rendered
      : (resolveTab(tabs, search.get('tab') ?? undefined)?.slug ?? rendered);

  // The strip moves on the click; the content follows when the server answers.
  // Without the first half a slow tab reads as a click that did nothing.
  const value = pending ? chosen : active;

  // Back and forward change `active` underneath us — follow it, and start each
  // tab at the top rather than wherever the last one was scrolled to.
  const first = useRef(true);
  useEffect(() => {
    setChosen(active);
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
  }, [active]);

  const discard = useCallback(() => {
    setDirty(false);
    setResetKey((key) => key + 1);
  }, []);

  /** Run `go` now, or once somebody has agreed to lose what they typed. */
  const guard = useCallback(
    (go: () => void) => {
      if (dirty) setLeaving(() => go);
      else go();
    },
    [dirty],
  );

  const choose = useCallback(
    (slug: string) => {
      if (slug === value) return;
      guard(() => {
        const href = tabHref(pathname, search.toString(), slug);
        if (panels !== undefined) {
          window.history.pushState(null, '', href);
          return;
        }
        setChosen(slug);
        startTransition(() => {
          router.push(href, { scroll: false });
        });
      });
    },
    [guard, panels, pathname, router, search, value],
  );

  /*
    Leaving the page while dirty.

    Closing or reloading is the browser's own prompt — `beforeunload` cannot
    carry our words. An in-app link is intercepted in the capture phase, before
    Next's `<Link>` handler runs, and replayed through the router once the
    question is answered. The browser's own back button is not interceptable in
    the App Router and is not caught: that is the one way out that skips the
    question.
  */
  useEffect(() => {
    if (!dirty) return;

    const onUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };

    const onClick = (event: MouseEvent): void => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      event.preventDefault();
      event.stopPropagation();
      setLeaving(() => () => router.push(`${url.pathname}${url.search}${url.hash}`));
    };

    window.addEventListener('beforeunload', onUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, router]);

  return (
    <TabsContext.Provider
      value={{ tabs, value, pending, dirty, setDirty, resetKey, discard, choose, panels }}
    >
      <Tabs value={value} onValueChange={choose} activationMode="manual">
        {children}
      </Tabs>

      <Dialog
        open={leaving !== null}
        onClose={() => setLeaving(null)}
        title={t('detailTabs.discardTitle')}
        description={t('detailTabs.discardBody')}
        closeLabel={t('common.close')}
      >
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setLeaving(null)}
            className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded border border-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t('detailTabs.keepEditing')}
          </button>
          <button
            type="button"
            onClick={() => {
              const go = leaving;
              setLeaving(null);
              discard();
              go?.();
            }}
            className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded bg-destructive font-medium text-destructive-foreground hover:bg-destructive/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
          >
            {t('detailTabs.discard')}
          </button>
        </div>
      </Dialog>
    </TabsContext.Provider>
  );
}

/**
 * The pill strip. Rendered by `PageShell` inside its sticky header, which is
 * why it takes nothing: everything it needs comes from `DetailTabs` above it.
 */
export function DetailTabStrip(): React.ReactElement {
  const t = useTranslations();
  const { tabs, value } = useTabs();
  const activeRef = useRef<HTMLButtonElement>(null);

  // On a phone the active tab may start off-screen to the right.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [value]);

  return (
    <TabsList aria-label={t('detailTabs.label')} className="-mx-1 px-1 py-1">
      {tabs.map((tab) => (
        <TabsTrigger
          key={tab.slug}
          value={tab.slug}
          ref={tab.slug === value ? activeRef : undefined}
        >
          {t(tab.labelKey)}
          {tab.badge?.kind === 'count' && (
            <span className="rounded-full bg-surface-muted px-1.5 text-xs tabular-nums text-foreground-muted">
              {tab.badge.value}
            </span>
          )}
          {tab.badge?.kind === 'dot' && (
            <>
              <span aria-hidden className="size-2 rounded-full bg-warning" />
              <span className="sr-only">{t(tab.badge.labelKey)}</span>
            </>
          )}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}

/**
 * The active tab's content, with the discard control under it.
 *
 * Only `input` / `change` events from a form that posts somewhere count as an
 * edit: a search box or a filter is a GET, and changing one is looking, not
 * editing.
 */
export function DetailTabPanel({ children }: { children: React.ReactNode }): React.ReactElement {
  const t = useTranslations();
  const { value, pending, dirty, setDirty, resetKey, discard, panels } = useTabs();
  const content = panels === undefined ? children : panels[value];
  const ref = useRef<HTMLDivElement>(null);

  // A new payload from the server is a save that landed (or a tab that
  // changed). The content keeps its identity across our own re-renders, so
  // this fires for those and nothing else.
  useEffect(() => {
    setDirty(false);
  }, [content, setDirty]);

  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    const onEdit = (event: Event): void => {
      const target = event.target;
      if (
        !(target instanceof HTMLInputElement) &&
        !(target instanceof HTMLTextAreaElement) &&
        !(target instanceof HTMLSelectElement)
      ) {
        return;
      }
      const form = target.form;
      if (form === null || form.method.toLowerCase() === 'get') return;
      setDirty(true);
    };
    node.addEventListener('input', onEdit);
    node.addEventListener('change', onEdit);
    return () => {
      node.removeEventListener('input', onEdit);
      node.removeEventListener('change', onEdit);
    };
  }, [setDirty]);

  return (
    <TabsContent
      value={value}
      ref={ref}
      aria-busy={pending}
      className={cn('flex flex-col gap-page-gap transition-opacity', pending && 'opacity-60')}
    >
      <div key={resetKey} className="contents">
        {content}
      </div>

      {dirty && (
        <div className="flex items-center justify-end gap-3">
          <span className="text-sm text-foreground-muted">{t('detailTabs.unsaved')}</span>
          <button
            type="button"
            onClick={discard}
            className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded border border-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t('detailTabs.cancel')}
          </button>
        </div>
      )}
    </TabsContent>
  );
}
