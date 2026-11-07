import { redirect } from 'next/navigation';
import { apiFetch, type Facilities } from '@/lib/api';

/** The tabs of a site the search bar can name. */
const TABS = new Set([
  'prices',
  'partners',
  'occupancy',
  'spaces',
  'maintenance',
  'regulation',
  'club',
  'documents',
  'photos',
]);

/**
 * A tab of *the* site — the search bar's way in. The bar knows no site id, and a
 * subscription covers one facility, so it names a tab and this finds the site.
 * A club with several is sent to Instalações to choose. Permissions stay where
 * they were: the page itself answers for who may see the tab.
 */
export async function GET(request: Request): Promise<never> {
  const asked = new URL(request.url).searchParams.get('tab') ?? '';
  const tab = TABS.has(asked) ? asked : null;
  const loaded = await apiFetch<Facilities>('/facilities').catch(() => null);
  const sites = loaded?.facilities ?? [];
  const only = sites.length === 1 ? sites[0] : undefined;
  if (only === undefined || tab === null) redirect('/dashboard/facilities');
  redirect(`/dashboard/facilities/${encodeURIComponent(only.id)}?tab=${tab}`);
}
