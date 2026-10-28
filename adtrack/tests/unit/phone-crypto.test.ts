import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskPhone, phoneDigits } from '../../src/lib/phone.ts';

process.env.LEAD_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
const { decrypt, encrypt, phoneHash } = await import('../../src/lib/crypto.ts');

test('전화번호 정리', () => {
  assert.equal(phoneDigits('010-1234-5678'), '01012345678');
  assert.equal(phoneDigits('010 1234 5678'), '01012345678');
  assert.equal(phoneDigits('+82 10-1234-5678'), '01012345678');
  assert.equal(phoneDigits('02-123-4567'), '021234567');
  assert.equal(phoneDigits('1234'), null);
  assert.equal(phoneDigits(''), null);
});

test('가운데 가리기', () => {
  assert.equal(maskPhone('01012345678'), '010-****-5678');
  assert.equal(maskPhone('021234567'), '02-***-4567');
  assert.equal(maskPhone('0311234567'), '031-***-4567');
});

test('암호화하면 원문이 보이지 않고 다시 풀린다', () => {
  const enc = encrypt('김민수');
  assert.ok(!enc.includes('김민수'));
  assert.notEqual(enc, encrypt('김민수')); // 매번 다른 IV
  assert.equal(decrypt(enc), '김민수');
  const tampered = enc.slice(0, -2) + (enc.endsWith('A') ? 'BB' : 'AA');
  assert.throws(() => decrypt(tampered));
});

test('같은 번호는 같은 해시', () => {
  assert.equal(phoneHash('01012345678'), phoneHash('01012345678'));
  assert.notEqual(phoneHash('01012345678'), phoneHash('01012345679'));
});
