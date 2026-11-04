import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { DashboardController } from './dashboard.controller.js';
import type { WeatherWidget } from './resolvers.js';
import { actingAs, addMember, closeHarness, withScratchTenant, type ScratchTenant } from '../test/harness.js';

/**
 * The weather card — POOLSE-170, against the real database, with the forecast
 * provider stubbed: a test never calls Open-Meteo. Each test uses coordinates
 * of its own, because the forecast cache is per place and outlives a test.
 *
 * Run: pnpm api:test   (needs pnpm db:up)
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
after(closeHarness);

/** The provider answering with a fixed forecast, or never answering at all. */
function provider(answer: 'ok' | 'hang'): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.includes('open-meteo') && !url.includes('forecast')) return realFetch(input, init);
    if (answer === 'hang') return new Promise<Response>(() => undefined);
    return new Response(
      JSON.stringify({
        current: { temperature_2m: 18.4, apparent_temperature: 17, precipitation: 0, weather_code: 2, is_day: 1, wind_speed_10m: 34 },
        daily: {
          time: ['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'],
          temperature_2m_min: [11, 10, 9, 12],
          temperature_2m_max: [20, 19, 17, 21],
          weather_code: [2, 61, 3, 0],
          precipitation_sum: [0, 4, 0, 0],
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
}

async function addSite(tenant: ScratchTenant, name: string, city: string | null, at: [number, number] | null) {
  const [row] = await tenant.sql<{ id: string }>(
    `INSERT INTO facility (organization_id, name, city, latitude, longitude) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenant.organizationId, name, city, at?.[0] ?? null, at?.[1] ?? null],
  );
  return row!.id;
}

function weatherOn(page: unknown): { state: string; data: WeatherWidget | null } | undefined {
  return (page as { bands: { widgets: { id: string; state: string; data: unknown }[] }[] }).bands
    .flatMap((band) => band.widgets)
    .find((one) => one.id === 'ops.weather') as { state: string; data: WeatherWidget | null } | undefined;
}

test('170 QA 1 — the selector’s site names its city, with now, today’s high and low and the days after', async () => {
  provider('ok');
  await withScratchTenant(async (tenant) => {
    await tenant.sql('UPDATE facility SET city = $2, latitude = 41.11, longitude = -8.61 WHERE id = $1', [
      tenant.facilityId,
      'Porto',
    ]);
    const aveiro = await addSite(tenant, 'Sede Aveiro', 'Aveiro', [40.64, -8.65]);
    // Two sites: the owner's selector is honoured.

    const page = await actingAs(tenant, { roles: ['owner'] }, () => new DashboardController().read(aveiro));
    const card = weatherOn(page);
    assert.equal(card?.state, 'ok');
    assert.equal(card!.data!.city, 'Aveiro');
    assert.equal(card!.data!.weather.temperatureC, 18.4);
    assert.equal(card!.data!.weather.days[0]!.maxC, 20, 'today first');
    assert.equal(card!.data!.weather.days.length, 4, 'today and three more');
  });
});

test('170 QA 2 — a site with no coordinates: no ops.weather in the raw payload', async () => {
  provider('ok');
  await withScratchTenant(async (tenant) => {
    const page = await actingAs(tenant, { roles: ['owner'] }, () => new DashboardController().read());
    assert.equal(JSON.stringify(page).includes('ops.weather'), false);
  });
});

test('170 QA 3 — a provider that never answers is the error card, and nothing else moves', async () => {
  provider('hang');
  await withScratchTenant(async (tenant) => {
    await tenant.sql('UPDATE facility SET city = $2, latitude = 38.72, longitude = -9.14 WHERE id = $1', [
      tenant.facilityId,
      'Lisboa',
    ]);
    const page = await actingAs(tenant, { roles: ['owner'] }, () => new DashboardController().read());
    assert.equal(weatherOn(page)?.state, 'error');
    assert.equal(
      page.bands.flatMap((band) => band.widgets).filter((one) => one.state === 'error').length,
      1,
      'only the weather failed',
    );
  });
});

test('170 QA 4 — a guardian gets the same card', async () => {
  provider('ok');
  await withScratchTenant(async (tenant) => {
    await tenant.sql('UPDATE facility SET city = $2, latitude = 37.02, longitude = -7.93 WHERE id = $1', [
      tenant.facilityId,
      'Faro',
    ]);
    const mother = await addMember(tenant, 'Marta', 'Silva', ['guardian']);
    const page = await actingAs(tenant, { membershipId: mother, roles: ['guardian'] }, () =>
      new DashboardController().read(),
    );
    const card = weatherOn(page);
    assert.equal(card?.state, 'ok');
    assert.equal(card!.data!.city, 'Faro');
  });
});
