import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documentsForSports } from './family-documents.js';

test('a swimmer sees the FPN declaration, and so does somebody in swimming and padel', () => {
  assert.equal(documentsForSports(['pool']).includes('fpn_declaration'), true);
  assert.equal(documentsForSports(['pool', 'padel']).includes('fpn_declaration'), true);
});

test('a child who only plays padel never sees it, and keeps the club’s own papers', () => {
  assert.deepEqual(documentsForSports(['padel']), ['socio_form', 'id_document', 'medical_exam']);
});

test('nobody in any sport yet still has the club’s own papers', () => {
  assert.deepEqual(documentsForSports([]), ['socio_form', 'id_document', 'medical_exam']);
});
