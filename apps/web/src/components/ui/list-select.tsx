'use client';

import { Fragment, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { CONTROL_LINE } from '@/components/ui/field';
import { cn } from '@/lib/utils';

/**
 * A dropdown whose list opens under its field — Rui, 12-11-2026.
 *
 * **Why not `<select>`.** A native select draws its popup with the operating
 * system, and Chrome on Windows draws a long one from the top of the screen
 * down: *Inscrever aluno* over 300 students opened a list the height of the
 * monitor, nowhere near the box that was clicked. The popup cannot be styled
 * or bounded. This one opens right under the field (above it when there is no
 * room below), at most 18rem tall, and scrolls inside itself.
 *
 * **It is still a form control.** The value posts under `name` from a hidden
 * input, `required` is enforced by that input, and `onInvalid` reaches the
 * field's own refusal the same way a select's does. The trigger is a button,
 * so a `<label htmlFor>` names it.
 *
 * **Keyboard.** Arrows, Home/End and Enter or Space open it and move through
 * it; typing letters jumps to the next label that starts with them; Enter
 * picks; Escape and Tab close it. Focus never leaves the button
 * (`aria-activedescendant`), and Escape belongs to the list while it is open
 * (`data-own-escape`, which `Dialog` respects).
 *
 * **A phone keeps the native picker** — its own sheet or wheel is the better
 * control there and never has this problem; a coarse pointer gets a styled
 * `<select>` after mount.
 *
 * **Portalled to `document.body`** with fixed coordinates, so a card's
 * `overflow-hidden` or a dialog's scroll box cannot clip it; it follows the
 * field on scroll and resize.
 */

export interface ListOption {
  value: string;
  label: string;
  disabled?: boolean | undefined;
  /** Options sharing a `group` are listed under it as a heading, in the order they come. */
  group?: string | undefined;
}

export interface ListSelectProps {
  id?: string | undefined;
  name?: string | undefined;
  value: string;
  /** `form`: the form the value posts in, as a select's `event.target.form`. */
  onValueChange: (value: string, form: HTMLFormElement | null) => void;
  options: ListOption[];
  required?: boolean | undefined;
  disabled?: boolean | undefined;
  /** Classes for the trigger; it starts from `CONTROL_LINE`. */
  className?: string | undefined;
  /** Shown when the value matches no option. */
  placeholder?: string | undefined;
  form?: string | undefined;
  onInvalid?: ((event: React.FormEvent<HTMLInputElement>) => void) | undefined;
  'aria-label'?: string | undefined;
  'aria-labelledby'?: string | undefined;
  'aria-describedby'?: string | undefined;
  'aria-invalid'?: boolean | undefined;
  'aria-busy'?: boolean | undefined;
  /** Kept off a draggable block underneath (the calendar grid's cells). */
  onPointerDown?: ((event: React.PointerEvent<HTMLButtonElement>) => void) | undefined;
  /** The caller styles the trigger wholly — a dense grid cell; no `CONTROL_LINE`. */
  unstyled?: boolean | undefined;
  title?: string | undefined;
}

const MAX_HEIGHT = 288; // 18rem
const GAP = 4;

interface Place {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
}

export function ListSelect(props: ListSelectProps): React.ReactElement {
  const { id, name, value, onValueChange, options, required, disabled, className, placeholder, form, onInvalid } = props;
  const ownId = useId();
  const listId = `${ownId}-list`;
  const optionId = (index: number): string => `${ownId}-option-${index}`;
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const posted = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [place, setPlace] = useState<Place | null>(null);
  const [coarse, setCoarse] = useState(false);
  const typed = useRef({ text: '', at: 0 });

  useEffect(() => {
    setCoarse(window.matchMedia('(pointer: coarse)').matches);
  }, []);

  const chosen = options.findIndex((option) => option.value === value);
  const shown = chosen >= 0 ? options[chosen]!.label : (placeholder ?? '');

  const measure = useCallback((): void => {
    const box = trigger.current?.getBoundingClientRect();
    if (box === undefined) return;
    const below = window.innerHeight - box.bottom - GAP - 8;
    const above = box.top - GAP - 8;
    const width = Math.min(Math.max(box.width, 192), window.innerWidth - 16);
    const left = Math.max(8, Math.min(box.left, window.innerWidth - width - 8));
    if (below >= Math.min(MAX_HEIGHT, 160) || below >= above) {
      setPlace({ left, width, top: box.bottom + GAP, maxHeight: Math.min(MAX_HEIGHT, Math.max(below, 96)) });
    } else {
      setPlace({ left, width, bottom: window.innerHeight - box.top + GAP, maxHeight: Math.min(MAX_HEIGHT, above) });
    }
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    const follow = (event: Event): void => {
      // Scrolling the list itself moves nothing.
      if (event.target instanceof Node && list.current?.contains(event.target)) return;
      measure();
    };
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, measure]);

  // A click anywhere but the field or its list closes it.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (trigger.current?.contains(target) || list.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open]);

  // The active row stays in sight.
  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active, place]);

  const pickable = (index: number): boolean => index >= 0 && index < options.length && options[index]!.disabled !== true;

  const step = (from: number, by: 1 | -1): number => {
    for (let index = from + by; index >= 0 && index < options.length; index += by) {
      if (pickable(index)) return index;
    }
    return from;
  };

  const first = (): number => step(-1, 1);
  const last = (): number => step(options.length, -1);

  const show = (at?: number): void => {
    if (disabled === true) return;
    setActive(at ?? (pickable(chosen) ? chosen : first()));
    setOpen(true);
  };

  const pick = (index: number): void => {
    if (!pickable(index)) return;
    setOpen(false);
    const next = options[index]!.value;
    if (next === value) return;
    // The posted input holds the new value now, as a select would, so a caller
    // that submits the form in its handler sends what was picked.
    if (posted.current !== null) posted.current.value = next;
    onValueChange(next, posted.current?.form ?? null);
  };

  const jump = (key: string): void => {
    const now = Date.now();
    const text = now - typed.current.at > 700 ? key : typed.current.text + key;
    typed.current = { text, at: now };
    const fold = (words: string): string => words.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const wanted = fold(text);
    const start = open ? active : chosen;
    const from = text.length === 1 ? start + 1 : Math.max(start, 0);
    for (let offset = 0; offset < options.length; offset += 1) {
      const index = (from + offset) % options.length;
      if (pickable(index) && fold(options[index]!.label).startsWith(wanted)) {
        if (open) setActive(index);
        else show(index);
        return;
      }
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        show();
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        jump(event.key);
      }
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((was) => step(was, 1));
        return;
      case 'ArrowUp':
        event.preventDefault();
        setActive((was) => step(was, -1));
        return;
      case 'Home':
        event.preventDefault();
        setActive(first());
        return;
      case 'End':
        event.preventDefault();
        setActive(last());
        return;
      case 'PageDown':
        event.preventDefault();
        setActive((was) => { let at = was; for (let n = 0; n < 8; n += 1) at = step(at, 1); return at; });
        return;
      case 'PageUp':
        event.preventDefault();
        setActive((was) => { let at = was; for (let n = 0; n < 8; n += 1) at = step(at, -1); return at; });
        return;
      case 'Enter':
      case ' ':
        if (event.key === ' ' && typed.current.text !== '' && Date.now() - typed.current.at < 700) {
          event.preventDefault();
          jump(' ');
          return;
        }
        event.preventDefault();
        pick(active);
        return;
      case 'Escape':
        event.preventDefault();
        setOpen(false);
        return;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) jump(event.key);
    }
  };

  const describe = {
    ...(props['aria-label'] === undefined ? {} : { 'aria-label': props['aria-label'] }),
    ...(props['aria-labelledby'] === undefined ? {} : { 'aria-labelledby': props['aria-labelledby'] }),
    ...(props['aria-describedby'] === undefined ? {} : { 'aria-describedby': props['aria-describedby'] }),
    ...(props['aria-invalid'] === true ? { 'aria-invalid': true as const } : {}),
    ...(props['aria-busy'] === undefined ? {} : { 'aria-busy': props['aria-busy'] }),
    ...(props.title === undefined ? {} : { title: props.title }),
  };

  if (coarse) {
    return (
      <select
        id={id}
        name={name}
        form={form}
        value={value}
        required={required}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.value, event.target.form)}
        onPointerDown={props.onPointerDown as ((event: React.PointerEvent<HTMLSelectElement>) => void) | undefined}
        onInvalid={onInvalid as ((event: React.FormEvent<HTMLSelectElement>) => void) | undefined}
        data-field=""
        className={cn(props.unstyled !== true && CONTROL_LINE, className)}
        {...describe}
      >
        {chosen < 0 && <option value={value} disabled hidden>{placeholder ?? ''}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled === true}>
            {option.group === undefined ? option.label : `${option.group} · ${option.label}`}
          </option>
        ))}
      </select>
    );
  }

  // No wrapper: the caller's width classes land on the button, as they did on the select.
  return (
    <>
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        {...(open && active >= 0 ? { 'aria-activedescendant': optionId(active) } : {})}
        {...(open ? { 'data-own-escape': '' } : {})}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onPointerDown={props.onPointerDown}
        onKeyDown={onKeyDown}
        data-field=""
        className={cn(
          props.unstyled !== true && CONTROL_LINE,
          'inline-flex items-center justify-between gap-1 text-left disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
        {...describe}
      >
        <span className={cn('min-w-0 truncate', chosen < 0 && 'text-foreground-muted')}>{shown}</span>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-foreground-muted" />
      </button>
      {/* The posted value, and what `required` is checked against. */}
      <input
        ref={posted}
        tabIndex={-1}
        aria-hidden
        name={name}
        form={form}
        value={value}
        required={required}
        disabled={disabled}
        onChange={() => undefined}
        onInvalid={(event) => {
          onInvalid?.(event);
          // The field says it in its own words: put the caret on the control.
          // Otherwise the browser's bubble shows here, beside the button.
          if (event.defaultPrevented) trigger.current?.focus();
        }}
        className="sr-only"
      />
      {open &&
        place !== null &&
        createPortal(
          <ul
            ref={list}
            id={listId}
            role="listbox"
            {...(props['aria-label'] === undefined ? {} : { 'aria-label': props['aria-label'] })}
            {...(props['aria-labelledby'] === undefined && id !== undefined ? { 'aria-labelledby': id } : {})}
            style={{
              position: 'fixed',
              left: place.left,
              minWidth: place.width,
              maxWidth: Math.max(place.width, Math.min(448, window.innerWidth - place.left - 8)),
              maxHeight: place.maxHeight,
              ...(place.top === undefined ? {} : { top: place.top }),
              ...(place.bottom === undefined ? {} : { bottom: place.bottom }),
            }}
            // The button keeps focus, so a click on a row must not take it.
            onMouseDown={(event) => event.preventDefault()}
            className="z-[70] overflow-y-auto rounded-sm border border-border bg-surface py-1 text-control shadow-card"
          >
            {options.map((option, index) => {
              const heading = option.group !== undefined && option.group !== options[index - 1]?.group;
              return (
                <li key={`${option.value}-${index}`} role="presentation">
                  {heading && (
                    <span className="block px-2.5 pb-0.5 pt-2 text-xs font-semibold text-foreground-muted">
                      {option.group}
                    </span>
                  )}
                  <span
                    id={optionId(index)}
                    role="option"
                    aria-selected={index === chosen}
                    aria-disabled={option.disabled === true ? true : undefined}
                    onClick={() => pick(index)}
                    onMouseMove={() => {
                      if (pickable(index) && active !== index) setActive(index);
                    }}
                    className={cn(
                      'flex min-h-8 cursor-default items-center gap-2 px-2.5 py-1',
                      index === active && 'bg-surface-muted',
                      option.disabled === true && 'cursor-not-allowed text-foreground-muted',
                      index === chosen && 'font-semibold',
                    )}
                  >
                    <Check aria-hidden className={cn('size-4 shrink-0', index === chosen ? 'text-primary' : 'invisible')} />
                    <span className="min-w-0 break-words">{option.label}</span>
                  </span>
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </>
  );
}

/** What a `SelectList`'s `onChange` receives: the parts of a change event the app reads. */
export interface SelectListChange {
  target: { value: string; name: string; form: HTMLFormElement | null };
  currentTarget: { value: string; name: string; form: HTMLFormElement | null };
}

type SelectListProps = Omit<ListSelectProps, 'value' | 'onValueChange' | 'options'> & {
  value?: string | number | undefined;
  /** Uncontrolled start; the form convention prefers `value`. */
  initial?: string | undefined;
  onChange?: ((event: SelectListChange) => void) | undefined;
  /** `<option>`s and `<optgroup>`s, exactly as a `<select>` takes them. */
  children: React.ReactNode;
};

/**
 * A `ListSelect` written like a `<select>` — 12-11-2026.
 *
 * The app has dozens of hand-built selects whose options come from data
 * (students, staff, a spreadsheet's columns, months, places). Swapping one is
 * a rename: the same `<option>` and `<optgroup>` children, the same
 * `onChange={(event) => …event.target.value}`. A hidden option is not listed;
 * when it is the current value its words are the placeholder.
 */
export function SelectList({ value, initial, onChange, children, name, placeholder, ...rest }: SelectListProps): React.ReactElement {
  const options: ListOption[] = [];
  let hiddenLabel: string | undefined;
  const [own, setOwn] = useState(initial ?? '');
  const current = value === undefined ? own : String(value);

  const walk = (node: React.ReactNode, group: string | undefined): void => {
    if (Array.isArray(node)) {
      for (const one of node) walk(one, group);
      return;
    }
    if (!isValidElement(node)) return;
    const props = node.props as { children?: React.ReactNode; value?: unknown; disabled?: boolean; hidden?: boolean; label?: string };
    if (node.type === Fragment) walk(props.children, group);
    else if (node.type === 'optgroup') walk(props.children, props.label);
    else if (node.type === 'option') {
      const label = textOf(props.children);
      const optionValue = props.value === undefined ? label : String(props.value);
      if (props.hidden === true) {
        if (optionValue === current) hiddenLabel = label;
        return;
      }
      options.push({ value: optionValue, label, disabled: props.disabled === true, group });
    }
  };
  walk(children, undefined);

  // Like a select with no `value`: the first option is the one shown.
  const shownValue = value === undefined && initial === undefined && own === '' && options[0] !== undefined ? options[0].value : current;

  return (
    <ListSelect
      {...rest}
      name={name}
      value={shownValue}
      placeholder={placeholder ?? hiddenLabel}
      options={options}
      onValueChange={(next, form) => {
        setOwn(next);
        const part = { value: next, name: name ?? '', form };
        onChange?.({ target: part, currentTarget: part });
      }}
    />
  );
}

function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'bigint') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf((node.props as { children?: React.ReactNode }).children);
  return '';
}
