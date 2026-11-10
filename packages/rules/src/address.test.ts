import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COUNTRY_CODES, isCountryCode, isPtDistrict, PT_DISTRICTS, ptDistrictFrom } from './address.js';

test('the twenty Portuguese distritos and regiões, once each', () => {
  assert.equal(PT_DISTRICTS.length, 20);
  assert.equal(new Set(PT_DISTRICTS).size, 20);
  assert.ok(isPtDistrict('Setúbal'));
  assert.ok(!isPtDistrict('setubal'), 'exactly as listed');
});

test("a geocoder's region lands on its distrito, however it is written", () => {
  assert.equal(ptDistrictFrom('Distrito de Aveiro'), 'Aveiro');
  assert.equal(ptDistrictFrom('Aveiro'), 'Aveiro');
  assert.equal(ptDistrictFrom('Lisbon District'), 'Lisboa');
  assert.equal(ptDistrictFrom('Setubal'), 'Setúbal');
  assert.equal(ptDistrictFrom('Azores'), 'Região Autónoma dos Açores');
  assert.equal(ptDistrictFrom('Região Autónoma da Madeira'), 'Região Autónoma da Madeira');
  assert.equal(ptDistrictFrom('Galicia'), null);
  assert.equal(ptDistrictFrom(null), null);
});

test('every ISO 3166-1 alpha-2 code, once', () => {
  assert.equal(COUNTRY_CODES.length, 249);
  assert.equal(new Set(COUNTRY_CODES).size, 249);
  assert.ok(isCountryCode('PT') && isCountryCode('ES'));
  assert.ok(!isCountryCode('XX') && !isCountryCode('pt'));
});
