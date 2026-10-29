// 5단계 성과 집계: 등록된 문의 기준, 한국 시간 기간, 광고비 일수 나누기, 키워드, 권한, 1만 건 속도
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { seedPerformanceExample } from '../fixtures/performance-example.mjs';

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const admin = { id: randomUUID(), email: `perf-admin-${Date.now()}@example.com` };
const staff = { id: randomUUID(), email: `perf-staff-${Date.now()}@example.com` };
let ws;

async function as(user, sql, params) {
  await db.query('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user.id]);
    await db.query('set local role authenticated');
    const r = await db.query(sql, params);
    await db.query('commit');
    return r.rows;
  } catch (err) {
    await db.query('rollback');
    throw err;
  }
}
const perf = (from, to, user = admin) => as(user, 'select public.performance($1, $2) as p', [from, to]).then((r) => r[0].p);
const byCode = (p, code) => p.channels.find((c) => c.code === code);

before(async () => {
  await db.connect();
  for (const u of [admin, staff]) await db.query('insert into auth.users (id, email) values ($1, $2)', [u.id, u.email]);
  [{ ws }] = await as(admin, "select public.create_workspace('성과 테스트', 'legal') as ws");
  await db.query("insert into public.users (id, workspace_id, email, role) values ($1, $2, $3, 'staff')", [staff.id, ws, staff.email]);
  await seedPerformanceExample(db, ws);
});

after(() => db.end());

test('9월 한 달: 예시 데이터의 손 계산과 같은 집계 (기간 밖 문의 제외)', async () => {
  const p = await perf('2026-09-01', '2026-09-30');
  const pick = (code) => { const c = byCode(p, code); return [c.spend, c.leads, c.contracts, Number(c.revenue)]; };
  assert.deepEqual(pick('naver_sa'), [1_000_000, 10, 3, 6_000_000]);
  assert.deepEqual(pick('google_ads'), [500_000, 6, 1, 1_500_000]);
  assert.deepEqual(pick('meta_ads'), [300_000, 4, 1, 400_000]);
  assert.deepEqual(pick('blog'), [0, 3, 1, 2_000_000]);
  assert.deepEqual(pick('referral'), [0, 2, 0, 0]);
  assert.deepEqual(pick('kakao_ads'), [0, 0, 0, 0]);
  assert.deepEqual({ ...p.unknown, revenue: Number(p.unknown.revenue) }, { leads: 2, contracts: 1, revenue: 500_000 });
  assert.deepEqual(p.attribution, { auto: 20, coupon: 1, asked: 2, manual: 2, unknown: 2 });
  assert.equal(p.stale, 15);
  assert.deepEqual(p.settings, { roas_high: 500, roas_low: 200, contract_term: '수임' });
  assert.equal(p.has_keyword_spend, true);
  assert.deepEqual(p.keywords.map((k) => [k.keyword, k.spend, k.leads, k.contracts, Number(k.revenue)]), [
    ['이혼전문변호사', 600_000, 6, 2, 5_000_000], // '이혼 전문변호사' 도 같은 키워드
    ['형사변호사', 400_000, 3, 1, 1_000_000],
  ]);
});

test('월 일부 기간: 광고비 = 월 금액 × (든 일수 ÷ 그 달 일수)', async () => {
  // 9/16~9/30 은 9월 30일 중 15일, 10/1~10/15 는 10월 31일 중 15일
  const p = await perf('2026-09-16', '2026-10-15');
  assert.equal(byCode(p, 'naver_sa').spend, 1_000_000 * 15 / 30 + 620_000 * 15 / 31); // 500,000 + 300,000
  assert.equal(byCode(p, 'naver_sa').spend, 800_000);
  assert.equal(byCode(p, 'google_ads').spend, 250_000);
  assert.deepEqual(p.keywords.map((k) => [k.keyword, k.spend]), [['이혼전문변호사', 300_000], ['형사변호사', 200_000]]);
  // 하루만
  assert.equal(byCode(await perf('2026-09-10', '2026-09-10'), 'naver_sa').spend, Math.round(1_000_000 / 30));
});

test('한국 시간 날짜 경계', async () => {
  const sep1 = await perf('2026-09-01', '2026-09-01');
  assert.equal(byCode(sep1, 'naver_sa').leads, 1, '9월 1일 00:05 문의 (UTC 8월 31일)');
  const aug31 = await perf('2026-08-31', '2026-08-31');
  assert.equal(byCode(aug31, 'naver_sa').leads, 1, '8월 31일 23:30 문의');
  const oct1 = await perf('2026-10-01', '2026-10-01');
  assert.equal(byCode(oct1, 'meta_ads').leads, 1, '10월 1일 00:10 문의');
});

test('잘못된 기간과 권한', async () => {
  await assert.rejects(perf('2026-09-30', '2026-09-01'), /기간을 확인/);
  await assert.rejects(perf('2025-01-01', '2026-09-01'), /1년까지/);
  await assert.rejects(perf('2026-09-01', '2026-09-30', staff), /관리자만/);
});

test('문의 1만 건 사업장에서도 성과 집계가 빠르다', async () => {
  const bigAdmin = { id: randomUUID(), email: `perf-big-${Date.now()}@example.com` };
  await db.query('insert into auth.users (id, email) values ($1, $2)', [bigAdmin.id, bigAdmin.email]);
  const [{ ws: big }] = await as(bigAdmin, "select public.create_workspace('큰 사업장', 'clinic') as ws");
  await db.query(`
    insert into public.leads (workspace_id, method, channel_id, attribution, status, contract_amount, keyword, created_at)
    select $1, 'form', c.id, 'auto',
      case when g % 5 = 0 then 'contracted' when g % 7 = 0 then 'failed' else 'new' end,
      case when g % 5 = 0 then 500000 end,
      case when c.code = 'naver_sa' then 'kw' || (g % 200) end,
      timestamptz '2026-01-01 00:00+09' + (g % 300) * interval '1 day' + (g % 1440) * interval '1 minute'
    from generate_series(1, 10000) g
    join lateral (select id, code from public.channels where workspace_id = $1 order by position offset (g % 6) limit 1) c on true`, [big]);
  await db.query(`
    insert into public.ad_spend (workspace_id, channel_id, month, amount)
    select $1, c.id, m::date, 1000000 from public.channels c, generate_series(date '2026-01-01', date '2026-10-01', interval '1 month') m
    where c.workspace_id = $1 and c.kind = 'paid'`, [big]);
  await db.query(`
    insert into public.keyword_spend (workspace_id, month, keyword, amount)
    select $1, m::date, 'kw' || k, 10000 from generate_series(0, 199) k, generate_series(date '2026-01-01', date '2026-10-01', interval '1 month') m`, [big]);
  await db.query('analyze public.leads');

  const started = performance.now();
  const p = await perf('2026-01-01', '2026-10-28', bigAdmin);
  const ms = performance.now() - started;
  const total = p.channels.reduce((n, c) => n + c.leads, 0);
  assert.equal(total, 10000);
  console.log(`# 문의 1만 건 성과 집계: ${Math.round(ms)}ms`);
  assert.ok(ms < 500, `${Math.round(ms)}ms`);
});
