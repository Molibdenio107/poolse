import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole } from '../tenant/roles.js';
import { composeDashboard, type Dashboard } from './compose.js';
import { readDashboardShape } from './dashboard.repository.js';
import { ROLES_WITH_DERIVED_FACILITIES } from './widget-registry.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `GET /dashboard` — the home page, as data — POOLSE-66, slice 1.
 *
 * **Every signed-in member may call it**, and what comes back is decided by what
 * they hold: an owner gets the management band, an instructor gets their own
 * work, somebody with neither gets `bands: []`. There is no `requireRole` here
 * because there is no single role this page is for — which is the whole reason
 * it is a union of bands rather than four screens.
 *
 * The permission work is in `widgetsFor`, ahead of every resolver, so a widget
 * the reader may not see is **absent from this payload**. A client that renders
 * whatever it is given cannot leak anything, because nothing was sent.
 */
@Controller('dashboard')
export class DashboardController {
  @Get()
  async read(@Query('facility') facility?: string): Promise<Dashboard> {
    const { organizationId, membershipId, roles } = currentTenant();

    const shape = await readDashboardShape(organizationId, membershipId);

    /*
     * The selector, in two readings that are deliberately different.
     *
     * A **malformed** value is no filter at all — it arrives from a link or a
     * bookmark, and a mistyped one should show the club rather than an error
     * page, which is the reading `/platform/tenants` already takes for its own
     * filter. A **well-formed uuid this club does not have** is a 404: that is
     * not a typo, it is a question about somebody else's site, and answering it
     * with "here is everything instead" would quietly widen what was asked for.
     */
    const asked = (facility ?? '').trim();
    const named = UUID.test(asked) ? asked : null;

    if (named !== null && !shape.facilities.some((site) => site.id === named)) {
      throw new NotFoundException('No such facility');
    }

    /*
     * The reader's own sites.
     *
     * For an owner or an admin that is every site in the club. For everybody
     * else it is empty for now, and that is enforced rather than hoped:
     * `assertRegistryIsSound` refuses to register a facility-scoped widget for a
     * role whose sites are not derived yet, so slice 3 adds the instructor
     * derivation here and to `ROLES_WITH_DERIVED_FACILITIES` in one change, or
     * its widgets do not exist.
     */
    const manages = hasRole(...ROLES_WITH_DERIVED_FACILITIES);
    const own = manages ? shape.facilities.map((site) => site.id) : [];

    return composeDashboard(
      {
        organizationId,
        membershipId,
        roles,
        facilityIds: named === null ? own : own.filter((id) => id === named),
        scope: named === null ? { mode: 'all', facilityId: null } : { mode: 'facility', facilityId: named },
        locale: shape.locale,
      },
      {
        kind: shape.kind,
        // The club's own sites, whoever is asking: this is what decides whether
        // the club is bare, and that is a fact about the club.
        sites: shape.facilities,
        // The selector is the management band's control. Nobody else is offered
        // it, so nobody else is sent its list.
        selector: manages ? shape.facilities : [],
      },
    );
  }
}
