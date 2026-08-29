'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Form fields that survive a failed submission — POOLSE-09 and POOLSE-10.
 *
 * **The bug these exist to stop.** React 19 resets a form automatically once a
 * function `action` returns — including when it returns a validation error. An
 * uncontrolled `<input defaultValue={…}>` therefore snaps back to whatever it
 * held at mount, so the misspelled email a person was asked to correct is wiped
 * before they can correct it, and a `<select defaultValue={current}>` reverts to
 * the value it had before the save it just succeeded at.
 *
 * Reported as two separate bugs on two separate screens; it is one, and it is
 * latent in every form in the app. Controlled state is the documented way out,
 * and these components exist so that is a decision made once rather than
 * remembered twenty times.
 *
 * They stay ordinary form controls: a `name`, a real value, and no JavaScript
 * required to submit. Nothing here breaks a form post.
 */

/**
 * What every control here looks like, and how big it is.
 *
 * The size is deliberate and shared. Controls were full-bleed and generously
 * padded, which is fine for a sign-up page with one box on it and wrong for a
 * backoffice: a postcode field the width of the window tells you it wants a
 * paragraph, and a form of eight of them becomes a page you scroll. `h-control`
 * and `max-w-field` are tokens rather than literals so the whole app's density
 * is two numbers in `tailwind.config.ts` — see the note there before changing
 * one of them here.
 */
const CONTROL =
  'w-full rounded border border-border-strong bg-background px-2.5 text-sm ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * Single-line controls take the height; a textarea takes padding instead.
 *
 * A fixed height on a textarea would fight `rows`, and `rows` is the property
 * the caller actually reasons about.
 */
const CONTROL_LINE = `${CONTROL} h-control`;
const CONTROL_BLOCK = `${CONTROL} py-2`;

/**
 * How wide the field's column is allowed to get.
 *
 * On the wrapper, not the control, so the label and the error message stop at
 * the same place the box does. A caller that genuinely wants the full width of
 * its container passes `className="max-w-none"` — a grid cell, mostly.
 */
const FIELD = 'flex w-full flex-col gap-1.5';

const INVALID = 'border-danger';

/**
 * Re-seeds from the server when — and only when — the server's value changes.
 *
 * Without the guard this would fight the person typing: every re-render would
 * shove the saved value back into the box. With it, a save that succeeds updates
 * the field, and a save that fails leaves what they wrote alone.
 */
function useSeeded(initial: string): [string, (next: string) => void] {
  const [value, setValue] = useState(initial);
  const seeded = useRef(initial);

  useEffect(() => {
    if (seeded.current === initial) return;
    seeded.current = initial;
    setValue(initial);
  }, [initial]);

  return [value, setValue];
}

interface Common {
  name: string;
  label: string;
  /** Translated message, or undefined. Rendered beside the field, never as a banner. */
  error?: string | undefined;
  hint?: string | undefined;
  required?: boolean;
  className?: string;
}

export function TextField({
  name,
  label,
  initial = '',
  type = 'text',
  error,
  hint,
  required,
  autoComplete,
  placeholder,
  maxLength,
  onValueChange,
  className,
}: Common & {
  initial?: string;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  maxLength?: number;
  /**
   * Told what was typed, for a parent that keeps its own copy.
   *
   * The field stays controlled by its own state either way — this is a
   * notification, not a handover. A caller that lifted the value entirely would
   * lose `useSeeded`, which is the part that makes a failed submission keep what
   * somebody wrote.
   */
  onValueChange?: (value: string) => void;
}): React.ReactElement {
  const id = useId();
  const [value, setValue] = useSeeded(initial);

  // The error is listed first so a screen reader says what is wrong before it
  // says what was expected.
  const describedBy = [error === undefined ? null : `${id}-error`, hint === undefined ? null : `${id}-hint`]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cn(FIELD, 'max-w-field', className)}>
      <label htmlFor={id} className="text-sm text-foreground-muted">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          onValueChange?.(event.target.value);
        }}
        required={required}
        autoComplete={autoComplete}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        className={cn(CONTROL_LINE, error !== undefined && INVALID)}
      />
      {hint !== undefined && (
        <p id={`${id}-hint`} className="text-sm text-foreground-muted">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextAreaField({
  name,
  label,
  initial = '',
  rows = 4,
  error,
  hint,
  required,
  placeholder,
  maxLength,
  className,
}: Common & {
  initial?: string;
  rows?: number;
  placeholder?: string;
  maxLength?: number;
}): React.ReactElement {
  const id = useId();
  const [value, setValue] = useSeeded(initial);

  const describedBy = [error === undefined ? null : `${id}-error`, hint === undefined ? null : `${id}-hint`]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cn(FIELD, 'max-w-form', className)}>
      <label htmlFor={id} className="text-sm text-foreground-muted">
        {label}
      </label>
      <textarea
        id={id}
        name={name}
        rows={rows}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        required={required}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        className={cn(CONTROL_BLOCK, error !== undefined && INVALID)}
      />
      {hint !== undefined && (
        <p id={`${id}-hint`} className="text-sm text-foreground-muted">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function SelectField({
  name,
  label,
  initial = '',
  options,
  error,
  hint,
  required,
  className,
}: Common & {
  initial?: string;
  options: { value: string; label: string }[];
}): React.ReactElement {
  const id = useId();
  const [value, setValue] = useSeeded(initial);

  const describedBy = [error === undefined ? null : `${id}-error`, hint === undefined ? null : `${id}-hint`]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cn(FIELD, 'max-w-field', className)}>
      <label htmlFor={id} className="text-sm text-foreground-muted">
        {label}
      </label>
      <select
        id={id}
        name={name}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        required={required}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        className={cn(CONTROL_LINE, error !== undefined && INVALID)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint !== undefined && (
        <p id={`${id}-hint`} className="text-sm text-foreground-muted">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Puts the caret in the first field that failed.
 *
 * POOLSE-09 asks for it, and it is the half of the fix people actually feel: a
 * form that keeps your input but leaves you hunting for which of six boxes is
 * wrong has only solved half the problem.
 *
 * Scoped to a form element rather than the document, so two forms on one page
 * cannot steal focus from each other.
 */
export function useFocusFirstError(
  form: React.RefObject<HTMLFormElement | null>,
  errors: Record<string, string> | undefined,
  attempt: unknown,
): void {
  useEffect(() => {
    if (errors === undefined || Object.keys(errors).length === 0) return;

    const invalid = form.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    invalid?.focus();
    // `attempt` changes on every submission, so a second failed attempt with the
    // same errors focuses again rather than sitting still.
  }, [form, errors, attempt]);
}
