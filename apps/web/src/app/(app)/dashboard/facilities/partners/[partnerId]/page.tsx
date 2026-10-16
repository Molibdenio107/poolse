import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type PartnerDetail, type Students } from '@/lib/api';
import { DetailPage } from '@/components/detail-page';
import { PageError } from '@/components/page-shell';
import { outcome } from '@/lib/load-failure';
import { EntityIcon } from '@/components/entity-icon';
import { PartnerIdentity } from './partner-identity';
import { PartnerContacts } from './partner-contacts';
import { PartnerAgreementPanel } from './partner-agreement';
import { PartnerGroups } from './partner-groups';
import { PartnerSchedule } from './partner-schedule';
import { backLabelKey, readFrom } from '@/lib/back';
import { storageConfigured } from '@/lib/storage-status';

/**
 * One partnership, in detail — POOLSE-47, criterion 9.
 *
 * Five sections, in the order the questions get asked: who are they, who do we
 * ring, what did we agree, which groups do they send, and when are they in the
 * water. The last one is read-only and comes from the bookings — it is the
 * partnership seen from the pool's side rather than from the contract's.
 *
 * **Tabs since the detail-tabs change**: the five sections are five tabs, the
 * identity being General. One request carries them all; only the register the
 * groups tab picks levels from waits for that tab.
 *
 * Nested under `facilities/` rather than at the top level because a partner
 * belongs to a facility, and the back link goes to the site it belongs to.
 */
export default async function PartnerPage({
  params,
  searchParams,
}: {
  params: Promise<{ partnerId: string }>;
  searchParams: Promise<{ tab?: string | string[]; from?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { partnerId } = await params;
  const storageReady = await storageConfigured();
  const { tab, from } = await searchParams;
  const origin = readFrom(from);

  let partner: PartnerDetail;
  try {
    partner = await apiFetch<PartnerDetail>(`/partners/${partnerId}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }

  return (
    <DetailPage
      title={partner.name}
      subtitle={[
        t(`partners.kind.${partner.type}`),
        t(`partners.state.${partner.status}`),
      ].join(' · ')}
      back={
        // Back to Turmas when that is where the link came from.
        origin === null
          ? { href: `/dashboard/facilities/${partner.facilityId}`, label: t('partners.backToSite') }
          : { href: origin, label: t(backLabelKey(origin) as never) }
      }
      actions={<EntityIcon kind="facility" className="mt-1.5 size-6 text-primary" />}
      requested={tab}
      tabs={[
        {
          slug: 'general',
          labelKey: 'detailTabs.general',
          content: () => <PartnerIdentity partner={partner} />,
        },
        {
          slug: 'contacts',
          labelKey: 'partners.contacts',
          badge: { kind: 'count', value: partner.contacts.length },
          content: () => (
            <PartnerContacts
              partnerId={partner.id}
              contacts={partner.contacts}
              canManage={partner.canManage}
            />
          ),
        },
        {
          slug: 'agreement',
          labelKey: 'partners.agreement',
          // The API sends no agreement to non-managers, so the tab would only
          // ever say there is none — 15-10-2026.
          visible: partner.canManage,
          content: () => (
            <PartnerAgreementPanel
              partnerId={partner.id}
              agreement={partner.agreement}
              canManage={partner.canManage}
              storageReady={storageReady}
            />
          ),
        },
        {
          slug: 'groups',
          labelKey: 'partners.groups',
          badge: { kind: 'count', value: partner.groups.length },
          content: async () => {
            /*
             * The levels, for the optional level a group can be pointed at.
             *
             * Best-effort: an instructor reading this page may not be able to
             * load the register, and losing the level *names* must not cost
             * them the tab. The picker only appears for somebody who can
             * manage anyway.
             */
            // A failed load says so rather than leaving the level picker
            // silently empty — 16-10-2026 sweep.
            const register = partner.canManage
              ? await outcome(apiFetch<Students>('/students'))
              : null;

            return (
              <>
                {register?.state === 'failed' && (
                  <PageError message={t(register.failure.key as never)} />
                )}
                <PartnerGroups
                  partnerId={partner.id}
                  groups={partner.groups}
                  levels={register?.state === 'ok' ? register.data.levels : []}
                  canManage={partner.canManage}
                />
              </>
            );
          },
        },
        {
          slug: 'schedule',
          labelKey: 'partners.schedule',
          content: () => <PartnerSchedule bookings={partner.bookings} />,
        },
      ]}
    />
  );
}
