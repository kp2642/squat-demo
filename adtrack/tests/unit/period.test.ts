import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coversWholeMonths, periodLabel, resolvePeriod, todayKst } from '../../src/lib/period.ts';

const now = new Date('2026-10-28T16:30:00Z'); // 한국 10월 29일 01:30

test('기간 고르기', () => {
  assert.equal(todayKst(now), '2026-10-29');
  assert.deepEqual(resolvePeriod({}, now), { key: 'this', from: '2026-10-01', to: '2026-10-29' });
  assert.deepEqual(resolvePeriod({ period: 'last' }, now), { key: 'last', from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(resolvePeriod({ period: '30d' }, now), { key: '30d', from: '2026-09-30', to: '2026-10-29' });
  assert.deepEqual(resolvePeriod({ period: 'custom', from: '2026-09-16', to: '2026-10-15' }, now), { key: 'custom', from: '2026-09-16', to: '2026-10-15' });
  assert.equal(resolvePeriod({ period: 'custom', from: '2026-10-15', to: '2026-09-16' }, now).key, 'this', '거꾸로면 기본');
  assert.equal(resolvePeriod({ period: 'custom', from: 'x', to: '2026-09-16' }, now).key, 'this');
  assert.deepEqual(resolvePeriod({ period: 'last' }, new Date('2026-01-15T00:00:00Z')), { key: 'last', from: '2025-12-01', to: '2025-12-31' });
});

test('표시와 달 전체 여부', () => {
  assert.equal(periodLabel('2026-09-01', '2026-09-30'), '2026. 9. 1. ~ 2026. 9. 30.');
  assert.ok(coversWholeMonths('2026-09-01', '2026-09-30'));
  assert.ok(coversWholeMonths('2026-08-01', '2026-09-30'));
  assert.ok(!coversWholeMonths('2026-10-01', '2026-10-29'));
  assert.ok(!coversWholeMonths('2026-09-16', '2026-10-15'));
});
