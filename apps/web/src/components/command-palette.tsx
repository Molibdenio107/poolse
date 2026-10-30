'use client';

import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { CornerDownLeft, Search, Zap } from 'lucide-react';
import type { PoolseModule, PoolseSport } from '@poolse/rules';
import type { OrganizationKind } from '@/lib/api';
import { Dialog } from '@/components/ui/dialog';
import { FromLink } from '@/components/from-link';
import { commandsFor, score, type Command } from '@/lib/commands';
import { applyTheme } from '@/lib/apply-theme';
import { setLocaleAction, setThemeAction } from '@/app/(app)/preferences.actions';
import { cn } from '@/lib/utils';

const RECENT_KEY = 'poolse.palette.recent';
const RECENT_MAX = 5;

/** The last few chosen, most recent first — a convenience, never a record. */
function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const list: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function remember(id: string): void {
  try {
    const next = [id, ...readRecent().filter((one) => one !== id)].slice(0, RECENT_MAX);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage refused (private mode, a full quota): the palette works without it.
  }
}

/**
 * The command palette — POOLSE-118. Ctrl+K / ⌘K anywhere in the backoffice,
 * or the search button in the app bar, opens one list: the pages the sidebar
 * would show this reader (its own entries, through its own filter), then a
 * few daily actions. Type to narrow — folded, synonym-aware, in the reader's
 * language — and Enter opens it.
 *
 * A page is opened by clicking its own `FromLink`, never `router.push`: the
 * link stamps `?from=` so *Voltar* comes back here, and a page that guards
 * unsaved typing (`DetailTabs`) is asked exactly as for any other link.
 */
export function CommandPalette({
  roles,
  kind,
  modules,
  sports,
}: {
  roles: readonly string[];
  kind: OrganizationKind;
  modules: readonly PoolseModule[];
  sports?: readonly PoolseSport[];
}): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const links = useRef<Map<string, HTMLAnchorElement>>(new Map());

  const commands = useMemo(
    () => commandsFor({ roles, kind, modules, ...(sports === undefined ? {} : { sports }) }),
    [roles, kind, modules, sports],
  );

  // Ctrl+K / ⌘K, on the window — ignored while another dialog is already open,
  // so it never opens on top of a question somebody is answering.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'k' || !(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (!open && document.querySelector('[role="dialog"]') !== null) return;
      event.preventDefault();
      setOpen((was) => !was);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    setRecent(readRecent());
  }, [open]);

  // POOLSE-125: *Calendário · Ténis* and *Calendário · Natação* are two entries.
  const label = (command: Command): string =>
    command.sportKey === undefined ? t(command.labelKey) : `${t(command.labelKey)} · ${t(command.sportKey)}`;

  const shown: Command[] = useMemo(() => {
    if (query.trim() === '') {
      const first = recent
        .map((id) => commands.find((command) => command.id === id))
        .filter((command): command is Command => command !== undefined);
      return [...first, ...commands.filter((command) => !first.includes(command))];
    }
    return commands
      .map((command) => ({ command, fit: score(command, label(command), query, locale) }))
      .filter((one): one is { command: Command; fit: number } => one.fit !== null)
      .sort((a, b) => b.fit - a.fit)
      .map((one) => one.command);
    // `label` reads `t`, which is stable for a locale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commands, query, recent, locale]);

  function choose(command: Command): void {
    remember(command.id);
    if ('href' in command.run) {
      links.current.get(command.id)?.click();
      setOpen(false);
      return;
    }
    setOpen(false);
    if (command.run.handler === 'toggleTheme') {
      const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
      applyTheme(next);
      const form = new FormData();
      form.set('theme', next);
      startTransition(() => setThemeAction(form));
      return;
    }
    // The two languages Poolse ships. Not read from i18n.ts, which is server-only.
    const other = locale === 'en' ? 'pt-PT' : 'en';
    const form = new FormData();
    form.set('locale', other);
    startTransition(async () => {
      await setLocaleAction(form);
      router.refresh();
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((at) => Math.min(shown.length - 1, at + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((at) => Math.max(0, at - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const command = shown[active];
      if (command !== undefined) choose(command);
    }
  }

  useEffect(() => {
    document.getElementById(`palette-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('palette.open')}
        aria-haspopup="dialog"
        className="inline-flex h-control items-center justify-center gap-2 rounded border border-border bg-surface px-3 text-control text-foreground-muted hover:bg-surface-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary max-md:w-control max-md:px-0"
      >
        <Search aria-hidden className="size-4 shrink-0" />
        <span className="hidden md:inline">{t('palette.search')}</span>
        {/* The shortcut is said on a desk only; a phone has no Ctrl. */}
        <kbd className="hidden rounded border border-border px-1.5 text-xs md:inline">
          {t('palette.shortcut')}
        </kbd>
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('palette.title')}
        description={t('palette.hint')}
        closeLabel={t('common.close')}
        initialFocus={input}
      >
        <div className="flex flex-col gap-3">
          <input
            ref={input}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={shown.length > 0 ? `palette-option-${active}` : undefined}
            aria-label={t('palette.title')}
            placeholder={t('palette.placeholder')}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            className="h-control w-full rounded border border-border bg-surface px-3 text-control"
          />
          {shown.length === 0 ? (
            <p className="text-sm text-foreground-muted">{t('palette.nothing')}</p>
          ) : (
            <ul id="palette-list" role="listbox" className="flex max-h-[min(24rem,60dvh)] flex-col overflow-y-auto">
              {shown.map((command, index) => {
                const isRecent = query.trim() === '' && recent.includes(command.id);
                const inner = (
                  <>
                    {command.kind === 'action' ? (
                      <Zap aria-hidden className="size-4 shrink-0 text-foreground-muted" />
                    ) : (
                      <CornerDownLeft aria-hidden className="size-4 shrink-0 text-foreground-muted" />
                    )}
                    <span className="flex-1 truncate">{label(command)}</span>
                    {isRecent && <span className="text-xs text-foreground-muted">{t('palette.recent')}</span>}
                    {command.kind === 'action' && !isRecent && (
                      <span className="text-xs text-foreground-muted">{t('palette.action.kind')}</span>
                    )}
                  </>
                );
                const className = cn(
                  'flex min-h-control w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm',
                  index === active ? 'bg-primary/15 text-primary' : 'text-foreground hover:bg-surface-muted',
                );
                return (
                  <li
                    key={command.id}
                    id={`palette-option-${index}`}
                    role="option"
                    aria-selected={index === active}
                    onMouseEnter={() => setActive(index)}
                  >
                    {'href' in command.run ? (
                      <FromLink
                        href={command.run.href}
                        tabIndex={-1}
                        ref={(element: HTMLAnchorElement | null) => {
                          if (element === null) links.current.delete(command.id);
                          else links.current.set(command.id, element);
                        }}
                        onClick={() => {
                          remember(command.id);
                          setOpen(false);
                        }}
                        className={className}
                      >
                        {inner}
                      </FromLink>
                    ) : (
                      <button type="button" tabIndex={-1} onClick={() => choose(command)} className={className}>
                        {inner}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Dialog>
    </>
  );
}
