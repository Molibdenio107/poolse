import { cn } from '@/lib/utils';

/**
 * A state, said in a word on a tint — the handoff's badge (Slice 5, Rui
 * 01-11-2026): 11 px bold, 2 px radius, padding 3/8, no border.
 *
 * **Five tones, each a meaning, never a decoration.** `ok` is done or fine
 * (paga, aberta); `pending` is waiting on somebody (MB WAY pendente, parcialmente
 * paga); `late` is behind and needs doing (em atraso, sem professor); `danger` is
 * a failure (o email não saiu); `muted` is quiet (anulada, isento). The tones are
 * our own green / primary / amber / red, not the handoff's orange (decided
 * 01-11-2026), and the text is each fill's ink, so it reads AA on its wash in
 * both themes (`contrast:check`).
 *
 * **The word is always there**, an icon optional beside it: colour never carries
 * the meaning alone. Roles, qualifications and lab grades keep their own chips,
 * so a state never looks like a role or a certificate.
 *
 * No hooks: it renders on the server or in a client component alike.
 */
export type BadgeTone = 'ok' | 'pending' | 'late' | 'danger' | 'muted';

const TONES: Record<BadgeTone, string> = {
  ok: 'bg-success/15 text-success',
  pending: 'bg-primary/[0.12] text-primary',
  late: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger',
  muted: 'bg-surface-muted text-foreground-muted',
};

export function Badge({
  tone,
  icon,
  className,
  children,
}: {
  tone: BadgeTone;
  /** Decorative, beside the word — hidden from a screen reader. */
  icon?: React.ReactNode;
  className?: string | undefined;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-sm px-2 py-[3px] text-[11px] font-bold leading-tight',
        TONES[tone],
        className,
      )}
    >
      {icon !== undefined && (
        <span aria-hidden className="inline-flex [&_svg]:size-3">
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}
