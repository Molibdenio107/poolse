import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whatsappNumber, whatsappUrl } from './whatsapp.js';

test('a Portuguese number takes its country code, however it was typed', () => {
  assert.equal(whatsappNumber('912345678'), '351912345678');
  assert.equal(whatsappNumber('912 345 678'), '351912345678');
  assert.equal(whatsappNumber('252-123-456'), '351252123456');
});

test('an international number stays as typed', () => {
  assert.equal(whatsappNumber('+351 912 345 678'), '351912345678');
  assert.equal(whatsappNumber('00351912345678'), '351912345678');
  assert.equal(whatsappNumber('+34 612 345 678'), '34612345678');
});

test('what cannot be a phone number is null', () => {
  for (const phone of [null, undefined, '', '   ', '123', 'ligar à mãe', '812345678', '+12345', '+1234567890123456']) {
    assert.equal(whatsappNumber(phone), null, String(phone));
  }
});

test('the text is encoded, so nothing in it can change the link', () => {
  const url = whatsappUrl('912345678', 'Olá & até já?\nhttps://x.pt/#a');
  assert.equal(url, `https://wa.me/351912345678?text=${encodeURIComponent('Olá & até já?\nhttps://x.pt/#a')}`);
  assert.equal(new URL(url!).searchParams.get('text'), 'Olá & até já?\nhttps://x.pt/#a');
  assert.equal(new URL(url!).hostname, 'wa.me');
  assert.equal(whatsappUrl('nada', 'Olá'), null);
});
