'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizePhoneE164,
  sha256Hash,
  calcDeliveryDeadline,
  isAllowlisted,
} = require('../src/plugins/sms-fallback/helpers');

test('normalizePhoneE164 — accepts a clean E.164 number', () => {
  assert.equal(normalizePhoneE164('+15555550100'), '+15555550100');
});

test('normalizePhoneE164 — strips formatting characters', () => {
  assert.equal(normalizePhoneE164(' +1 (555) 555-0100 '), '+15555550100');
});

test('normalizePhoneE164 — converts 00-prefixed numbers to +', () => {
  assert.equal(normalizePhoneE164('0044 20 7946 0958'), '+442079460958');
});

test('normalizePhoneE164 — rejects numbers without a country code', () => {
  assert.throws(() => normalizePhoneE164('5555550100'), /E\.164/);
  assert.throws(() => normalizePhoneE164('06 12 34 56 78'), /E\.164/);
});

test('normalizePhoneE164 — rejects too short / too long', () => {
  assert.throws(() => normalizePhoneE164('+12345'), /E\.164/);                 // 6 digits, too short
  assert.throws(() => normalizePhoneE164('+1234567890123456'), /E\.164/);      // 16 digits, too long
});

test('normalizePhoneE164 — rejects empty / non-string', () => {
  assert.throws(() => normalizePhoneE164(''), /no digits|string/);
  assert.throws(() => normalizePhoneE164(null), /string/);
  assert.throws(() => normalizePhoneE164(15555550100), /string/);
});

test('sha256Hash — deterministic hex digest', () => {
  assert.equal(
    sha256Hash('hello world'),
    'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'
  );
});

test('sha256Hash — distinct content yields distinct hash', () => {
  assert.notEqual(sha256Hash('a'), sha256Hash('b'));
});

test('calcDeliveryDeadline — adds milliseconds to baseDate', () => {
  const base = new Date('2026-01-01T00:00:00Z');
  const out = calcDeliveryDeadline(60_000, base);
  assert.equal(out.toISOString(), '2026-01-01T00:01:00.000Z');
});

test('calcDeliveryDeadline — rejects negative or non-finite offsets', () => {
  assert.throws(() => calcDeliveryDeadline(-1));
  assert.throws(() => calcDeliveryDeadline(NaN));
  assert.throws(() => calcDeliveryDeadline(Infinity));
});

test('isAllowlisted — matches any configured prefix', () => {
  assert.equal(isAllowlisted('+15555550100', ['+1', '+44']), true);
  assert.equal(isAllowlisted('+442079460958', ['+1', '+44']), true);
});

test('isAllowlisted — rejects when no prefix matches', () => {
  assert.equal(isAllowlisted('+33612345678', ['+1', '+44']), false);
});

test('isAllowlisted — rejects empty / missing allowlist', () => {
  assert.equal(isAllowlisted('+15555550100', []), false);
  assert.equal(isAllowlisted('+15555550100', null), false);
  assert.equal(isAllowlisted('+15555550100', undefined), false);
});

test('isAllowlisted — rejects empty phone', () => {
  assert.equal(isAllowlisted('', ['+1']), false);
  assert.equal(isAllowlisted(null, ['+1']), false);
});
