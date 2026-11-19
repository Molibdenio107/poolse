import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingDetails, requiredDetails } from './required-details.js';

const minor = { adultPathStudent: false };
const adult = { adultPathStudent: true };

test('owner, admin and guardian give a name and a mobile', () => {
  for (const role of ['owner', 'admin', 'guardian']) {
    assert.deepEqual(requiredDetails([role], minor), ['firstName', 'lastName', 'mobile'], role);
  }
});

test('instructor and maintenance also give a NIF and a morada', () => {
  const staff = ['firstName', 'lastName', 'mobile', 'taxNumber', 'address', 'postalCode', 'locality'];
  assert.deepEqual(requiredDetails(['instructor'], minor), staff);
  assert.deepEqual(requiredDetails(['maintenance'], minor), staff);
});

test('a student is asked only on the adult path', () => {
  assert.deepEqual(requiredDetails(['student'], minor), []);
  assert.deepEqual(requiredDetails(['student'], adult), ['firstName', 'lastName', 'mobile']);
});

test('several roles ask for the union, in form order', () => {
  assert.deepEqual(requiredDetails(['guardian', 'instructor'], minor), requiredDetails(['instructor'], minor));
  assert.deepEqual(requiredDetails(['admin', 'student'], adult), ['firstName', 'lastName', 'mobile']);
});

test('an unknown role asks for nothing', () => {
  assert.deepEqual(requiredDetails(['platform'], minor), []);
  assert.deepEqual(requiredDetails([], minor), []);
});

test('blank, whitespace and absent are missing; a value is not', () => {
  const required = requiredDetails(['instructor'], minor);
  assert.deepEqual(
    missingDetails(required, {
      firstName: 'Ana',
      lastName: '  ',
      mobile: null,
      taxNumber: '123456789',
      address: 'Rua A',
      postalCode: '1000-001',
    }),
    ['lastName', 'mobile', 'locality'],
  );
  assert.deepEqual(missingDetails(['firstName'], { firstName: 'Ana' }), []);
});
