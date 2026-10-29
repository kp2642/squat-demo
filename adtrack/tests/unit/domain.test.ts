import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, parseDomains, isValidDomain, normalizeDomain } from '../../src/lib/domain.ts';

test('홈페이지 주소를 도메인으로 정리한다', () => {
  assert.equal(normalizeDomain('https://www.A-Law.kr/contact?x=1'), 'a-law.kr');
  assert.equal(normalizeDomain('http://shop.example.com:8080/'), 'shop.example.com');
  assert.equal(normalizeDomain('  example.co.kr  '), 'example.co.kr');
  assert.deepEqual(parseDomains('a.com\nhttps://www.a.com, b.co.kr\n\n'), ['a.com', 'b.co.kr']);
});

test('도메인 형식 확인', () => {
  assert.ok(isValidDomain('a-law.co.kr'));
  assert.ok(!isValidDomain('localhost'));
  assert.ok(!isValidDomain('한글.com'));
});

test('금액 입력', () => {
  assert.equal(parseAmount('3,000,000원'), 3000000);
  assert.equal(parseAmount('0'), 0);
  assert.equal(parseAmount('-1'), null);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount(' 원 '), null);
});
