/**
 * The sports a club can have — POOLSE-124.
 *
 * **One list.** The `sport` table is the catalogue (POOLSE-122) and spells
 * exactly these keys; `sport-modules.integration.test.ts` reads the table back
 * and compares, so the two cannot drift. A new sport is a row there and a value
 * here.
 *
 * A sport is a paid add-on, the other way round from a module: a club stores
 * what is switched **on** (`organization.enabled_sports`), `{pool}` is the
 * default, and `pool` is always on (Decided 8: the pilot is a pool).
 */
export const POOLSE_SPORTS = [
  'pool',
  'tennis',
  'padel',
  'basketball',
  'football',
  'handball',
  'volleyball',
  'gym',
] as const;

export type PoolseSport = (typeof POOLSE_SPORTS)[number];

/** The sport every club has and none can switch off. */
export const BASE_SPORT: PoolseSport = 'pool';

export function isPoolseSport(value: unknown): value is PoolseSport {
  return typeof value === 'string' && (POOLSE_SPORTS as readonly string[]).includes(value);
}

/**
 * A club's switched-on sports, in catalogue order, with the pool always first —
 * what `/me` hands the web app. A key the catalogue does not know is dropped
 * rather than trusted.
 */
export function enabledSports(org: { enabledSports: readonly string[] }): PoolseSport[] {
  const on = new Set(org.enabledSports);
  return POOLSE_SPORTS.filter((sport) => sport === BASE_SPORT || on.has(sport));
}

/** The switched-on sports beyond the pool: one add-on line each. */
export function addonSports(org: { enabledSports: readonly string[] }): PoolseSport[] {
  return enabledSports(org).filter((sport) => sport !== BASE_SPORT);
}

/** Whether a recinto of this sport may be made in this club. The API answers 403 `sport_not_enabled` otherwise. */
export function mayCreateRecinto(sport: string, org: { enabledSports: readonly string[] }): boolean {
  return isPoolseSport(sport) && enabledSports(org).includes(sport);
}
