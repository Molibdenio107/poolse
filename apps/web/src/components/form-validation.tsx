'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { validityKey } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';

/**
 * Every form says what is missing — 1 November 2026 (Rui: "it says error, but
 * does not specify what is mandatory or missing … apply this rule to every
 * form"). Mounted once per root layout, like `FormResetGuard`, so no form has
 * to remember it.
 *
 * When a submit is stopped because controls are invalid (a required box left
 * empty, an email that is not one), the browser fires `invalid` at each of
 * them. This listens to all of them at once and:
 *
 * - **silences the browser's bubble** — gone in two seconds, in the browser's
 *   language, naming one field of several;
 * - **raises one toast naming the fields** by their labels ("Corrija os campos
 *   assinalados: Apelido, Email"), so the message says what is wrong;
 * - **focuses the first** and brings it into view.
 *
 * The message under each field is the field's own (`TextField` & co. in
 * `ui/field.tsx`); a hand-built control is named in the toast all the same.
 */
export function FormValidation(): null {
  const toast = useToast();
  const t = useTranslations();

  useEffect(() => {
    let pending: HTMLElement[] = [];
    let timer: number | null = null;

    const flush = (): void => {
      const fields = pending;
      pending = [];
      timer = null;
      if (fields.length === 0) return;
      const names = [...new Set(fields.map(labelOf).filter((name) => name !== ''))];
      const first = fields[0]!;
      first.scrollIntoView({ block: 'center' });
      first.focus({ preventScroll: true });
      const shown = names.slice(0, 4).join(', ') + (names.length > 4 ? '…' : '');
      toast.show('danger', names.length === 0 ? t('common.checkTheFields') : t('common.validation.toast', { fields: shown }));
    };

    // `invalid` does not bubble, so it is caught on the way down.
    const onInvalid = (event: Event): void => {
      const control = event.target;
      if (
        !(control instanceof HTMLInputElement) &&
        !(control instanceof HTMLSelectElement) &&
        !(control instanceof HTMLTextAreaElement)
      ) {
        return;
      }
      event.preventDefault();
      pending.push(control);
      // A hand-built control (no `data-field`) gets the field's sentence too.
      if (!control.hasAttribute('data-field')) sayUnder(control, t(`common.validation.${validityKey(control.validity)}`));
      // One submit fires one event per invalid control in the same task: say them together.
      timer ??= window.setTimeout(flush, 0);
    };

    document.addEventListener('invalid', onInvalid, true);
    return () => {
      document.removeEventListener('invalid', onInvalid, true);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [toast, t]);

  return null;
}

/**
 * The sentence under a hand-built control, until it is edited. Placed after the
 * control — or after the label wrapping it — as a sibling React does not own;
 * it is taken away on the control's next input, so a re-render never meets a
 * stale one. `aria-describedby` points at it while it is there.
 */
function sayUnder(control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, message: string): void {
  // A radio group is one question: one sentence, after the group.
  const group = control instanceof HTMLInputElement && control.type === 'radio' ? groupOf(control) : null;
  const anchor = group ?? control.closest('label') ?? control;
  const existing = anchor.nextElementSibling;
  if (existing instanceof HTMLElement && existing.dataset['ownRefusal'] === control.name) {
    existing.textContent = message;
    return;
  }
  const note = document.createElement('p');
  note.dataset['ownRefusal'] = control.name;
  note.id = `own-refusal-${Math.random().toString(36).slice(2)}`;
  note.className = 'mt-1 text-sm text-danger';
  note.textContent = message;
  anchor.after(note);
  const before = control.getAttribute('aria-describedby');
  control.setAttribute('aria-describedby', before === null ? note.id : `${note.id} ${before}`);
  control.setAttribute('aria-invalid', 'true');
  const clear = (): void => {
    note.remove();
    if (before === null) control.removeAttribute('aria-describedby');
    else control.setAttribute('aria-describedby', before);
    control.removeAttribute('aria-invalid');
    control.removeEventListener('input', clear);
    control.removeEventListener('change', clear);
  };
  control.addEventListener('input', clear);
  control.addEventListener('change', clear);
}

/** The element holding a radio group: its fieldset, else its radiogroup. */
function groupOf(radio: HTMLInputElement): HTMLElement | null {
  return radio.closest<HTMLElement>('fieldset, [role="radiogroup"]');
}

/** A control's name as the reader sees it: its label without the required mark; a radio's group legend. */
function labelOf(control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLElement): string {
  if (control instanceof HTMLInputElement && control.type === 'radio') {
    const group = groupOf(control);
    const legend = group?.querySelector('legend')?.textContent ?? group?.getAttribute('aria-label') ?? null;
    if (legend !== null) return legend.replace(/\s*\*\s*$/, '').trim();
  }
  const fromLabel = 'labels' in control && control.labels !== null ? control.labels[0]?.textContent : null;
  const text = fromLabel ?? control.getAttribute('aria-label') ?? '';
  return text.replace(/\s*\*\s*$/, '').trim();
}
