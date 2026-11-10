import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatClubPhone, normalizeClubPhone, whatsappNumber, whatsappUrl } from './whatsapp.js';

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


test('POOLSE-210: stores a Portuguese number typed any way as +351 and nine digits', () => {
  assert.equal(normalizeClubPhone('912 345 678'), '+351912345678');
  assert.equal(normalizeClubPhone('00351 212345678'), '+351212345678');
  assert.equal(normalizeClubPhone('+351 21 234 5678'), '+351212345678');
});
test('POOLSE-210: keeps a foreign number with its country code', () => {
  assert.equal(normalizeClubPhone('+34 612 345 678'), '+34612345678');
});
test('POOLSE-210: refuses what is no number', () => {
  assert.equal(normalizeClubPhone('12345'), null);
  assert.equal(normalizeClubPhone('ligue-nos'), null);
  assert.equal(normalizeClubPhone(''), null);
});
test('POOLSE-210: reads a Portuguese number in groups of three, any other as stored', () => {
  assert.equal(formatClubPhone('+351212345678'), '+351 212 345 678');
  assert.equal(formatClubPhone('+34612345678'), '+34612345678');
});
