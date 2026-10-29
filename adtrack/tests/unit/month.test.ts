import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentMonth, isMonth, monthLabel, shiftMonth } from '../../src/lib/month.ts';

test('달 계산', () => {
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(monthLabel('2026-09'), '2026년 9월');
  assert.ok(isMonth('2026-09'));
  assert.ok(!isMonth('2026-13'));
  assert.ok(!isMonth('2026-9'));
  // 한국 시간 기준: UTC 9월 30일 16시 = 한국 10월 1일 새벽
  assert.equal(currentMonth(new Date('2026-09-30T16:00:00Z')), '2026-10');
  assert.equal(currentMonth(new Date('2026-09-30T14:00:00Z')), '2026-09');
});
