import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import type { BoletimData, BoletimPlacement } from '@poolse/rules';
import { formPdf } from './form-pdf.ts';

/** A 1×1 JPEG, the smallest thing a page can be drawn from. */
const JPEG = Uint8Array.from(Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8QH//Z',
  'base64',
));

const values = {
  name: 'João Ñandú Łukasz',
  parentOneName: null,
  parentTwoName: null,
  birthDate: null,
  maritalStatus: null,
  profession: null,
  education: null,
  birthplace: null,
  nationality: null,
  addressLine: 'Rua Álvares Cabral',
  locality: null,
  postalCode: null,
  phone: null,
  email: null,
  taxNumber: null,
  idDocumentNumber: null,
  snsNumber: null,
  socioNumber: null,
  socioSince: null,
  guardian: null,
} as BoletimData;

const placements: BoletimPlacement[] = [
  { field: 'name', x: 0.1, y: 0.2, sizePt: 11, width: 0.3 },
  { field: 'address_line', x: 0.1, y: 0.3, sizePt: 11 },
  // Empty on the record: nothing drawn, nothing thrown.
  { field: 'locality', x: 0.1, y: 0.4, sizePt: 11 },
];

const build = () =>
  formPdf({ image: JPEG, contentType: 'image/jpeg', placements, values, today: '2026-11-06', title: 'Boletim de sócio' });

test('a form is one page, as wide as A4, and a file a PDF reader opens', async () => {
  const bytes = await build();
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), '%PDF-');
  const read = await PDFDocument.load(bytes);
  assert.equal(read.getPageCount(), 1);
  assert.equal(Math.round(read.getPage(0).getWidth()), 595);
});

test('a name Helvetica cannot write does not stop the form', async () => {
  await assert.doesNotReject(build());
});

test('the metadata names the form and never the person', async () => {
  const read = await PDFDocument.load(await build());
  assert.equal(read.getTitle(), 'Boletim de sócio');
  assert.equal(`${read.getAuthor() ?? ''}${read.getSubject() ?? ''}`.includes('João'), false);
});
