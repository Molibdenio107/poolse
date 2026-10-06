import { PageShell } from '@/components/page-shell';
import { DetailTabPanel, DetailTabs, DetailTabStrip } from '@/components/detail-tabs';
import { resolveTab, visibleTabs, type TabSpec } from '@/lib/detail-tabs';

/**
 * A record's page as tabs — one card (or one group of cards that are one
 * conversation) per tab, under a sticky title and pill strip.
 *
 * **Every detail page uses this; one card is one tab, and the first is
 * General.** Pages had grown to a dozen stacked sections, and the thing
 * somebody came for was usually the tenth.
 *
 * **Only the active tab is fetched.** Each tab's `content` is a function, and
 * this calls exactly one of them: a tab nobody opens costs the API nothing.
 * Revisiting a tab fetches it again, which is what keeps it true after a save
 * on another tab — accepted deliberately over a client cache that every
 * panel's save would have to remember to invalidate. A badge is the exception:
 * its count has to be known before its tab is opened, so a page that shows one
 * runs that query up front, and says so where it does.
 *
 * **A tab somebody may not use is absent, not disabled** — from the strip and
 * from the URL. `visible` carries the page's existing answer (a `can*` flag, or
 * a list that came back null because the endpoint refused); this adds no rule.
 */

export interface DetailPageTab extends TabSpec {
  content: () => React.ReactNode | Promise<React.ReactNode>;
}

export async function DetailPage({
  title,
  subtitle,
  back,
  actions,
  tabs,
  requested,
}: {
  title: string;
  subtitle?: string | undefined;
  back?: { href: string; label: string } | undefined;
  actions?: React.ReactNode;
  tabs: DetailPageTab[];
  /** `searchParams.tab`, as the page received it. */
  requested: string | string[] | undefined;
}): Promise<React.ReactElement> {
  const active = resolveTab(tabs, requested);
  const content = active === null ? null : await active.content();
  const strip = visibleTabs(tabs).map(({ slug, labelKey, badge }) => ({
    slug,
    labelKey,
    badge,
  }));

  return (
    <DetailTabs tabs={strip} active={active?.slug ?? ''}>
      <PageShell
        title={title}
        subtitle={subtitle}
        back={back}
        actions={actions}
        tabs={<DetailTabStrip />}
      >
        <DetailTabPanel>{content}</DetailTabPanel>
      </PageShell>
    </DetailTabs>
  );
}
