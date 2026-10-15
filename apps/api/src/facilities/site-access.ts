/**
 * Who may open a site's own page — 15 October 2026, Rui's call. It is where
 * the club is configured, so owner and admin (a support session resolves as
 * admin); maintenance too, but the web shows them only Espaços, Manutenção and
 * Energia, which are their daily work. Everybody else has the Instalações list.
 *
 * Read by `GET /facilities/:id` and by every link that would lead there.
 */
export const SITE_PAGE_ROLES = ['owner', 'admin', 'maintenance'] as const;
