import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { cn } from '@/lib/utils';

/**
 * The one back control — backlog round 3, story 10.
 *
 * It replaced thirteen hand-written links across twelve pages, each with its own
 * wording: "Voltar ao registo", "Voltar às turmas", "Voltar ao painel". The story
 * is right about why that mattered — a control you have to read before you can
 * use it is not a control, it is a sentence — and right that fixing it page by
 * page produces three slightly different back buttons within a month.
 *
 * Two decisions inside it are worth knowing:
 *
 * **The destination is an `href`, not `history.back()`.** The story asks for "the
 * actual previous screen in context", and history is not that: after a redirect
 * it goes back to the form that was just submitted, and on a link opened from an
 * email it leaves the app entirely. Every caller already knew its parent, so
 * every caller passes it, and the control always lands somewhere that exists.
 * The browser's own back button is untouched and still does what it always did.
 *
 * **The visible text is always "Voltar"; the destination is named to screen
 * readers.** Uniform text is the point of the story. But "Voltar" repeated on
 * every screen with no other cue is worse for someone listening to a page than
 * the old contextual labels were — so the contextual phrase survives as the
 * accessible name. Sighted users get consistency, screen-reader users keep the
 * information, and neither pays for the other.
 *
 * A server component, like every page that uses it.
 */
export async function BackLink({
  href,
  /** Names the destination to assistive technology — "Voltar ao registo". */
  label,
  className,
}: {
  href: string;
  label?: string;
  className?: string;
}): Promise<React.ReactElement> {
  const t = await getTranslations();

  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(
        'inline-flex items-center gap-1.5 self-start rounded text-sm text-primary',
        'hover:underline',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        className,
      )}
    >
      <ArrowLeft className="size-4" aria-hidden />
      {t('common.back')}
    </Link>
  );
}
