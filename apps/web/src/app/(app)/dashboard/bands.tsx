import { subMenuPillClass } from '@/components/section-pills';
import { Fragment } from 'react';
import { FromLink } from '@/components/from-link';
import { getTranslations } from 'next-intl/server';
import type { Dashboard } from '@/lib/api';
import { renderWidget } from './widgets';
import { SummaryBand } from './summary-band';

/**
 * The dashboard as bands — POOLSE-66, slice 2a.
 *
 * **A union of the reader's roles, in the payload's order.** The server decides
 * which bands exist and which cards are in them; this renders what it is given
 * and makes no judgement of its own. In particular a band the reader holds no
 * role in is *absent from the payload*, so there is nothing here to hide — which
 * is the whole reason the gating is server-side.
 *
 * **The heading is the point of the grouping.** An owner who also teaches gets a
 * management band and an operational one, and without names the page reads as an
 * arbitrary pile of cards. It is shown even when there is only one band: a
 * reader who sees "Operação" learns that there is somewhere else the rest of the
 * product lives.
 *
 * Three columns at `lg`, one below it, with each card spanning what the registry
 * gave it. The sizes are the server's opinion about weight, not a layout — a
 * narrow screen ignores them entirely and stacks.
 *
 * **Everything is resolved before anything is returned.** The cards are async
 * components, so mapping them inside the JSX would hand React an array of
 * promises; `Promise.all` up front also means one slow card cannot stagger the
 * band it is in.
 */
export async function Bands({ dashboard }: { dashboard: Dashboard }): Promise<React.ReactElement> {
  const t = await getTranslations();
  const family = dashboard.family;
  const chosen = family?.children.find((child) => child.id === family.selectedId);

  const bands = await Promise.all(
    dashboard.bands.map(async (band) => ({
      id: band.id,
      widgets: band.widgets,
      cards: await Promise.all(
        band.widgets.map(async (widget) => ({
          id: widget.id,
          element: await renderWidget(widget, dashboard.scope, dashboard.family),
        })),
      ),
    })),
  );

  return (
    <>
      {bands
        // The top row draws nothing with no note and no weather: no section over nothing.
        .filter((band) => band.id !== 'notes' || band.cards.some((card) => card.element !== null))
        .map((band) => (
        <section key={band.id} className="flex flex-col gap-3">
          {/* The top row's two cards carry their own headings; the band's is for a screen reader. */}
          <h2
            className={
              band.id === 'notes'
                ? 'sr-only'
                : 'text-sm font-medium uppercase tracking-wider text-foreground-muted'
            }
          >
            {t(`dashboard.band.${band.id}`)}
            {band.id === 'personal' && chosen !== undefined && <> · {chosen.name}</>}
          </h2>

          {/*
            Whose cards these are — slice 5. Plain links, so the choice lives in
            the address (`?child=`, Rui's call) and Back works; offered only
            when there is a choice. The current one says so in words as well
            as weight.
          */}
          {band.id === 'personal' && family !== null && family.children.length > 1 && (
            <nav aria-label={t('family.picker')} className="flex flex-wrap gap-1.5">
              {family.children.map((child) => {
                const current = child.id === family.selectedId;
                return (
                  <FromLink
                    key={child.id}
                    href={`/dashboard?child=${child.id}`}
                    aria-current={current ? 'page' : undefined}
                    className={subMenuPillClass(current)}
                  >
                    {child.self ? t('family.yourselfShort', { name: child.name }) : child.name}
                  </FromLink>
                );
              })}
            </nav>
          )}

          {/* The summary is laid out, not a grid of cards (multi-sport Slice 2). */}
          {band.id === 'summary' ? (
            <SummaryBand widgets={band.widgets} />
          ) : band.id === 'notes' ? (
            /*
             * The top of the page (Rui, 04-11-2026): the staff board on the left,
             * 65 %, and the weather on the right, 35 % — in its column whether or
             * not a note is pinned, so it never moves. Stacked on a phone.
             */
            <div className="grid grid-cols-1 gap-page-gap lg:grid-cols-[minmax(0,65fr)_minmax(0,35fr)]">
              {band.cards.find((card) => card.id === 'staff.notes')?.element ?? null}
              <div className="flex min-w-0 flex-col lg:col-start-2">
                {band.cards.find((card) => card.id === 'ops.weather')?.element ?? null}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-page-gap lg:grid-cols-3">
              {band.cards.map((card) => (
                <Fragment key={card.id}>{card.element}</Fragment>
              ))}
            </div>
          )}
        </section>
      ))}
    </>
  );
}
