'use client';

import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
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
export const CONTROL_BASE =
  'w-full min-w-0 rounded-sm border border-border-strong bg-background px-2.5 text-control ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * Single-line controls take the height; a textarea takes padding instead.
 *
 * A fixed height on a textarea would fight `rows`, and `rows` is the property
 * the caller actually reasons about.
 */
export const CONTROL_LINE = `${CONTROL_BASE} h-control`;
export const CONTROL_BLOCK = `${CONTROL_BASE} py-2`;

/**
 * The label above a control, and the column the two sit in.
 *
 * Exported because sixteen forms in this app predate these components and build
 * their controls by hand. They cannot all be converted in one change — several
 * are typeaheads and grids with their own state — but they can share the classes,
 * which is the part that has to agree. A form styled by hand from these constants
 * is a form that changes density when the tokens do.
 */
export const FIELD_LABEL = 'text-sm text-foreground-muted';

/**
 * The column a label and its control sit in — including the width cap.
 *
 * The cap lives here, and not only on `TextField` and `SelectField`, because the
 * hand-built forms are the ones that looked wrong. They share `CONTROL_LINE` and
 * `FIELD_LABEL` already, so they matched on height and colour and then stretched
 * their inputs to whatever the grid cell gave them — which on a single-column
 * form is the entire form. Density that only half the app obeys is not density.
 *
 * A field that genuinely wants to be wider says so: `cn(FIELD_COLUMN,
 * 'max-w-form')` for prose, `max-w-none` for a grid cell that manages its own
 * width. Both merge correctly — `cn` is tailwind-merge, so the later max-width
 * wins rather than the two fighting.
 */
// `min-w-0`: a field in a row may shrink below its input's natural width
// rather than pushing the page wider than a phone — October 2026.
export const FIELD_COLUMN = 'flex w-full min-w-0 max-w-field flex-col gap-1.5';

/**
 * How wide the field's column is allowed to get.
 *
 * On the wrapper, not the control, so the label and the error message stop at
 * the same place the box does. A caller that genuinely wants the full width of
 * its container passes `className="max-w-none"` — a grid cell, mostly.
 */
const FIELD = FIELD_COLUMN;

export const CONTROL_INVALID = 'border-danger';
const INVALID = CONTROL_INVALID;

/**
 * Re-seeds from the server when — and only when — the server's value changes.
 *
 * Without the guard this would fight the person typing: every re-render would
 * shove the saved value back into the box. With it, a save that succeeds updates
 * the field, and a save that fails leaves what they wrote alone.
 *
 * **Exported for the hand-built controls** — the form-debt sweep, 15 October
 * 2026. A price row or an inventory line cannot take a labelled `TextField`
 * without changing shape, so it keeps its markup and takes this instead:
 * `const [v, setV] = useSeeded(server)` and `value={v} onChange={…}`. A
 * checkbox passes a boolean and binds `checked`. `defaultValue` and
 * `defaultChecked` are refused by `scripts/check-forms.mjs`.
 *
 * **`resetKey` is for a form that stays on screen to be typed into again** —
 * add a slot, add a record, add an item. React used to clear those on success
 * by itself; a controlled field does not, so the form passes
 * `useSuccessKey(state)` and the field goes back to `initial` after each save
 * that worked, and never after one that failed.
 */
export function useSeeded<T extends string | boolean>(
  initial: T,
  resetKey?: number,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(initial);
  const seeded = useRef(initial);
  const resetAt = useRef(resetKey);

  useEffect(() => {
    if (seeded.current === initial) return;
    seeded.current = initial;
    setValue(initial);
  }, [initial]);

  useEffect(() => {
    if (resetAt.current === resetKey) return;
    resetAt.current = resetKey;
    setValue(seeded.current);
  }, [resetKey]);

  return [value, setValue];
}

/**
 * A number that goes up once for every save that worked — the `resetKey` a
 * create form hands its fields. Keyed on the state object's identity, because
 * `ok` stays true across renders and two successes in a row are two resets.
 */
export function useSuccessKey(state: { ok?: boolean }): number {
  const [key, setKey] = useState(0);
  const seen = useRef(state);

  useEffect(() => {
    if (seen.current === state) return;
    seen.current = state;
    if (state.ok === true) setKey((n) => n + 1);
  }, [state]);

  return key;
}

/**
 * A field's label, and the mark that says it is required — 1 November 2026
 * (Rui: "it does not say what is mandatory"). The asterisk is the mark; the
 * control's own `required` is what a screen reader announces, so the mark is
 * hidden from it rather than said twice. `FormValidation` strips it back off
 * when it names the field in a toast.
 */
function FieldLabel({
  htmlFor,
  required,
  children,
}: {
  htmlFor: string;
  required: boolean | undefined;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <label htmlFor={htmlFor} className="text-sm text-foreground-muted">
      {children}
      {required === true && (
        <span aria-hidden className="text-danger">
          {' *'}
        </span>
      )}
    </label>
  );
}

/** What a field says when the browser judges it invalid — `common.validation.*`, already translated. */
export interface ValidationMessages {
  required: string;
  length: string;
  range: string;
  format: string;
  invalid: string;
}

/**
 * The words, handed down rather than looked up: a field is used on public pages
 * too, which translate on the server and have no intl provider. The app layout
 * provides them from the catalogue and the public registration page from its own
 * translator; with neither, the browser's own message is the fallback.
 */
const ValidationText = createContext<ValidationMessages | null>(null);
export function ValidationMessagesProvider({
  messages,
  children,
}: {
  messages: ValidationMessages;
  children: React.ReactNode;
}): React.ReactElement {
  return <ValidationText.Provider value={messages}>{children}</ValidationText.Provider>;
}

/** Which of those messages fits, from the browser's own judgement of the control. */
export function validityKey(validity: ValidityState): keyof ValidationMessages {
  if (validity.valueMissing) return 'required';
  if (validity.tooLong || validity.tooShort) return 'length';
  if (validity.rangeUnderflow || validity.rangeOverflow || validity.stepMismatch) return 'range';
  if (validity.typeMismatch || validity.patternMismatch || validity.badInput) return 'format';
  return 'invalid';
}

/**
 * A field's own refusal, said under it before the server is asked — 1 November
 * 2026. A required box left empty used to be caught by the browser's bubble:
 * gone in two seconds, in the browser's language, pointing at one field of
 * several. Now the field says it in its own words, in place, until it is
 * edited; the server's message (`error`), when there is one, wins.
 */
function useOwnRefusal(error: string | undefined): {
  shown: string | undefined;
  onInvalid: (event: React.FormEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
  clear: () => void;
} {
  const words = useContext(ValidationText);
  const [own, setOwn] = useState<string | undefined>(undefined);
  return {
    shown: error ?? own,
    onInvalid: (event) => {
      event.preventDefault();
      const control = event.currentTarget;
      setOwn(words === null ? control.validationMessage : words[validityKey(control.validity)]);
    },
    clear: () => setOwn(undefined),
  };
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
  inputMode,
  readOnly,
  onValueChange,
  className,
  inputClassName,
}: Common & {
  initial?: string;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  maxLength?: number;
  /**
   * The keypad to offer, for a field that holds digits but is not `type="number"`.
   *
   * A number input carries browser validation that refuses silently — the bubble
   * does not always show, and the form then does nothing with no explanation
   * (POOLSE-QA-07). Those fields are text validated by the API, and this is what
   * keeps a phone showing the right keyboard.
   */
  inputMode?: 'numeric' | 'decimal' | 'tel';
  /** Shown and still sent, not editable: a value somebody else owns (POOLSE-177). */
  readOnly?: boolean | undefined;
  /**
   * Extra classes on the `<input>` itself, where `className` styles the column.
   *
   * There is one thing this is for: a `::placeholder` rule, which only applies
   * on the element carrying it and so cannot be passed down through the wrapper.
   * Sizing, colour and state belong to `CONTROL_LINE` — a caller reaching in
   * here to change those is a caller making this field disagree with the other
   * fifteen forms on the page.
   */
  inputClassName?: string;
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
  const refusal = useOwnRefusal(error);
  const shown = refusal.shown;

  // The error is listed first so a screen reader says what is wrong before it
  // says what was expected.
  const describedBy = [shown === undefined ? null : `${id}-error`, hint === undefined ? null : `${id}-hint`]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cn(FIELD, 'max-w-field', className)}>
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          refusal.clear();
          onValueChange?.(event.target.value);
        }}
        required={required}
        onInvalid={refusal.onInvalid}
        data-field=""
        autoComplete={autoComplete}
        placeholder={placeholder}
        maxLength={maxLength}
        inputMode={inputMode}
        readOnly={readOnly}
        aria-invalid={shown === undefined ? undefined : true}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        className={cn(CONTROL_LINE, shown !== undefined && INVALID, readOnly === true && 'bg-surface-muted', inputClassName)}
      />
      {hint !== undefined && (
        <p id={`${id}-hint`} className="text-sm text-foreground-muted">
          {hint}
        </p>
      )}
      {shown !== undefined && (
        <p id={`${id}-error`} className="text-sm text-danger">
          {shown}
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
  onValueChange,
}: Common & {
  initial?: string;
  rows?: number;
  placeholder?: string;
  maxLength?: number;
  /** Told about every change, for a form that must read the text before submit. */
  onValueChange?: (value: string) => void;
}): React.ReactElement {
  const id = useId();
  const [value, setValue] = useSeeded(initial);
  const refusal = useOwnRefusal(error);
  const shown = refusal.shown;

  const describedBy = [shown === undefined ? null : `${id}-error`, hint === undefined ? null : `${id}-hint`]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cn(FIELD, 'max-w-form', className)}>
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      <textarea
        id={id}
        name={name}
        rows={rows}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          refusal.clear();
          onValueChange?.(event.target.value);
        }}
        required={required}
        onInvalid={refusal.onInvalid}
        data-field=""
        placeholder={placeholder}
        maxLength={maxLength}
        aria-invalid={shown === undefined ? undefined : true}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        className={cn(CONTROL_BLOCK, shown !== undefined && INVALID)}
      />
      {hint !== undefined && (
        <p id={`${id}-hint`} className="text-sm text-foreground-muted">
          {hint}
        </p>
      )}
      {shown !== undefined && (
        <p id={`${id}-error`} className="text-sm text-danger">
          {shown}
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
  onValueChange,
  className,
}: Common & {
  initial?: string;
  /** `disabled`: listed but not choosable — a recinto with nothing bookable yet (02-11-2026). */
  options: { value: string; label: string; disabled?: boolean }[];
  /**
   * Told what was chosen, for a parent that derives something from it.
   *
   * The same escape hatch `TextField` has, and controlled the same way: the
   * select still owns its value, this only reports it. Added in round 4 for the
   * age bounds, where the unit picker and the number together decide one posted
   * figure and the parent is the only place that can compute it.
   */
  onValueChange?: ((value: string) => void) | undefined;
}): React.ReactElement {
  const id = useId();
  const [value, setValue] = useSeeded(initial);
  const refusal = useOwnRefusal(error);
  const shown = refusal.shown;

  const describedBy = [shown === undefined ? null : `${id}-error`, hint === undefined ? null : `${id}-hint`]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cn(FIELD, 'max-w-field', className)}>
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      <select
        id={id}
        name={name}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          refusal.clear();
          onValueChange?.(event.target.value);
        }}
        required={required}
        onInvalid={refusal.onInvalid}
        data-field=""
        aria-invalid={shown === undefined ? undefined : true}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        className={cn(CONTROL_LINE, shown !== undefined && INVALID)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled === true}>
            {option.label}
          </option>
        ))}
      </select>
      {hint !== undefined && (
        <p id={`${id}-hint`} className="text-sm text-foreground-muted">
          {hint}
        </p>
      )}
      {shown !== undefined && (
        <p id={`${id}-error`} className="text-sm text-danger">
          {shown}
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
