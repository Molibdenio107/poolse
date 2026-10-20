/**
 * The parts of Poolse a club can have switched off — POOLSE-87.
 *
 * **One list.** The SQL enum `poolse_module` spells exactly these values, and
 * `modules.integration.test.ts` reads the enum back and compares, so the two
 * cannot drift. Everything not named here is core: sites and pools, seasons,
 * turmas, the calendar, students, people, fees — the teaching operation, which
 * nobody switches off.
 *
 * It is a rollout tool, not pricing (Rui, 20-10-2026): Rui switches a module on
 * when a club is ready for it, from `/admin`. A trial is the full product, which
 * is why a club stores what is *off* and an empty list means everything.
 *
 * A module earns its value in the ticket that builds it — the AI dashboards are
 * not here because they do not exist yet.
 */
export const POOLSE_MODULES = [
  'messages',
  'incidents',
  'reception',
  'competition',
  'water_quality',
  'invoicing',
  'maintenance',
  'energy',
  'salaries',
  'vacations',
  'qualifications',
] as const;

export type PoolseModule = (typeof POOLSE_MODULES)[number];

export function isPoolseModule(value: unknown): value is PoolseModule {
  return typeof value === 'string' && (POOLSE_MODULES as readonly string[]).includes(value);
}

/**
 * What a module cannot run without.
 *
 * **Reception needs invoicing** (Rui, 20-10-2026, POOLSE-87 Open 1): a free-swim
 * sale is an `invoice_line` and voiding a pass is a credit note, so reception
 * with invoicing off would sell entries onto documents nobody can see.
 *
 * The SQL function `modules_consistent()` says the same thing, and the
 * integration test proves the two agree over every pair.
 */
export const MODULE_REQUIRES: Readonly<Partial<Record<PoolseModule, readonly PoolseModule[]>>> = {
  reception: ['invoicing'],
};

/** A module left on while something it needs is off. */
export interface ModuleDependencyBreach {
  module: PoolseModule;
  requires: PoolseModule;
}

/**
 * Every breach a set of switched-off modules would leave — empty when it is
 * consistent. Refused, never resolved: Poolse does not switch a second module
 * off because somebody switched off the first.
 */
export function moduleDependencyBreaches(
  disabled: readonly PoolseModule[],
): ModuleDependencyBreach[] {
  const off = new Set(disabled);
  const breaches: ModuleDependencyBreach[] = [];
  for (const module of POOLSE_MODULES) {
    if (off.has(module)) continue;
    for (const requires of MODULE_REQUIRES[module] ?? []) {
      if (off.has(requires)) breaches.push({ module, requires });
    }
  }
  return breaches;
}

/** The enabled list `/me` hands the web app: every module not switched off, in list order. */
export function enabledModules(disabled: readonly string[]): PoolseModule[] {
  const off = new Set(disabled);
  return POOLSE_MODULES.filter((module) => !off.has(module));
}
