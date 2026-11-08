import { getTranslations } from 'next-intl/server';
import { StickyNote } from 'lucide-react';
import { apiFetch, type StaffNote } from '@/lib/api';
import { outcome } from '@/lib/load-failure';
import { formatDate } from '@/lib/date-format';
import { cn } from '@/lib/utils';
import { RemoveNoteButton } from './staff-board-forms';

/**
 * The staff board — POOLSE-169 (Rui, 04-11-2026).
 *
 * Any employee pins a post-it every other one sees, at the top of the Painel
 * and of the instructor's and maintenance's app homes; writing one is
 * `NewNoteButton` in the page's header, kept apart so the notes come first. A note stays until its
 * author or the office takes it down; it is never edited. Drawn as paper:
 * `.post-it` in globals.css (four papers, one ink, a shadow and a slight tilt).
 *
 * The words are plain text, as typed — never HTML. Two notes to a row on a
 * phone, so the board does not push the day off the screen.
 */
export async function StaffBoard({
  notes,
  className,
  titled = true,
  title = 'staffNotes.title',
}: {
  notes: readonly StaffNote[];
  className?: string;
  /** The teacher's app calls it the club's board (Rui, 07-11-2026). */
  title?: 'staffNotes.title' | 'staffNotes.clubTitle';
  /** False on the Painel, where the band's heading already names the board. */
  titled?: boolean;
}): Promise<React.ReactElement | null> {
  const t = await getTranslations();
  // Nothing pinned is nothing drawn: *Novo recado* in the header is how one starts.
  if (notes.length === 0) return null;
  return (
    <section aria-label={t(title)} className={cn('flex flex-col gap-3', className)}>
      {titled && (
        <h2 className="flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-foreground-muted">
          <StickyNote aria-hidden className="size-4" />
          {t(title)}
        </h2>
      )}
      <ul className="grid grid-cols-2 gap-4 p-1 sm:gap-5 xl:grid-cols-3">
        {notes.map((note) => (
          <li
            key={note.id}
            className={cn(
              'post-it relative flex min-h-28 flex-col gap-2 p-3 pr-8 sm:min-h-36 sm:p-4 sm:pr-9',
              `post-it-${note.colour}`,
            )}
          >
            <p className="line-clamp-6 flex-1 whitespace-pre-wrap break-words text-sm">{note.body}</p>
            <p className="post-it-muted text-xs">
              {/* The role in words beside its colour, so the paper never says it alone. */}
              {note.authorRole === null
                ? t('staffNotes.byline', {
                    name: note.authorName ?? t('staffNotes.someone'),
                    date: formatDate(note.createdAt),
                  })
                : t('staffNotes.bylineRole', {
                    name: note.authorName ?? t('staffNotes.someone'),
                    role: t(`roles.${note.authorRole}`),
                    date: formatDate(note.createdAt),
                  })}
            </p>
            {note.canRemove && <RemoveNoteButton noteId={note.id} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The board on an app home: the notes, or nothing. The page puts *Novo recado*
 * in its own header. A failure says so in one line rather than taking the home
 * down.
 */
export async function StaffBoardHome({
  title,
}: {
  title?: 'staffNotes.title' | 'staffNotes.clubTitle';
} = {}): Promise<React.ReactElement | null> {
  const t = await getTranslations();
  const loaded = await outcome(apiFetch<{ notes: StaffNote[] }>('/staff-notes'));
  if (loaded.state === 'refused') return null;
  if (loaded.state === 'failed') {
    return <p className="text-sm text-foreground-muted">{t('staffNotes.failed')}</p>;
  }
  return <StaffBoard notes={loaded.data.notes} {...(title === undefined ? {} : { title })} />;
}
