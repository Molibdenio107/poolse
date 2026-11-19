import type { ComponentProps } from 'react';
import type { LucideIcon } from 'lucide-react';
import { FromLink } from '@/components/from-link';
import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'secondary';

const BASE =
  'inline-flex min-h-control items-center justify-center gap-2 rounded-sm px-4 text-control font-semibold ' +
  'transition-[background-color,border-color,color,transform] duration-200 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ' +
  'disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:pointer-events-none aria-disabled:opacity-60 ' +
  'motion-safe:hover:-translate-y-px motion-safe:disabled:hover:translate-y-0';

const VARIANT: Record<ButtonVariant, string> = {
  /** The brand fill with the dark ink (6.6:1, `interface.md`): the one thing a page exists to start. */
  primary: 'bg-primary text-primary-foreground shadow-card hover:bg-primary/90',
  /**
   * Outlined teal (Rui, 19-11-2026, POOLSE-232), the border in the primary *ink*
   * (the fill is 2.72:1 on white, under the 3:1 a control's edge needs): a related action beside the
   * primary — *Importar*. An exception to the handoff's borderless secondary,
   * for the buttons this ticket switched; the rest keep theirs until touched.
   */
  secondary: 'border border-[rgb(var(--primary-ink))] bg-surface text-primary hover:bg-primary/10',
};

/** The classes alone, for a control that is not a `<button>` or a link (a file picker's label). */
export function buttonClass(variant: ButtonVariant = 'primary', className?: string): string {
  return cn(BASE, VARIANT[variant], className);
}

type Common = {
  variant?: ButtonVariant;
  /** A leading picture; decorative — the words carry the meaning. */
  icon?: LucideIcon;
  className?: string;
  children: React.ReactNode;
};

/**
 * The one button — POOLSE-232 (Rui, 19-11-2026).
 *
 * Every page used to declare its own (63 local `BUTTON` constants, most of them
 * the handoff's white card), so a page's main action looked like the cards
 * around it. `primary` is a page's main "add"; `secondary` its *Importar*.
 * Given `href` it is a `FromLink`, so Voltar still knows the way back
 * (POOLSE-91); otherwise a `<button>`, `type="button"` unless told otherwise.
 * One size, `h-control` (`min-h-control` so long words wrap on a phone).
 *
 * The remaining local constants move here page by page, when each file is next
 * touched — refactor by proposal, never a sweep.
 */
export function Button(
  props:
    | (Common & { href: string } & Omit<ComponentProps<typeof FromLink>, 'href' | 'className' | 'children'>)
    | (Common & { href?: undefined } & Omit<ComponentProps<'button'>, 'className' | 'children'>),
): React.ReactElement {
  const { variant = 'primary', icon: Icon, className, children, ...rest } = props;
  const classes = buttonClass(variant, className);
  const content = (
    <>
      {Icon !== undefined && <Icon className="size-4 shrink-0" aria-hidden />}
      {children}
    </>
  );
  if (rest.href !== undefined) {
    const { href, ...link } = rest as { href: string } & Omit<ComponentProps<typeof FromLink>, 'href'>;
    return (
      <FromLink href={href} className={classes} {...link}>
        {content}
      </FromLink>
    );
  }
  const { type = 'button', ...button } = rest as ComponentProps<'button'>;
  return (
    // eslint-disable-next-line react/button-has-type -- `type` is a prop, defaulting to "button"
    <button type={type} className={classes} {...button}>
      {content}
    </button>
  );
}
