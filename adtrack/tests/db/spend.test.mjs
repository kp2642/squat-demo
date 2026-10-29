// 4단계 광고비: 월·채널 입력, 지난 달 복사, 키워드 CSV 반영, 채널 관리, 권한
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const admin = { id: randomUUID(), email: `spend-admin-${Date.now()}@example.com` };
const staff = { id: randomUUID(), email: `spend-staff-${Date.now()}@example.com` };
const other = { id: randomUUID(), email: `spend-other-${Date.now()}@example.com` };
let ws;
let ch; // code → id
let otherChannel;

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
const one = (user, sql, params) => as(user, sql, params).then((r) => r[0] && Object.values(r[0])[0]);
const month = (user, m) => one(user, 'select public.spend_month($1)', [m]);
const amountOf = (m, code) => m.channels.find((c) => c.code === code).amount;

before(async () => {
  await db.connect();
  for (const u of [admin, staff, other]) await db.query('insert into auth.users (id, email) values ($1, $2)', [u.id, u.email]);
  ws = await one(admin, "select public.create_workspace('광고비 테스트', 'clinic', array['spend-test.kr'])");
  await one(other, "select public.create_workspace('다른 곳', 'legal')");
  await db.query("insert into public.users (id, workspace_id, email, role) values ($1, $2, $3, 'staff')", [staff.id, ws, staff.email]);
  ch = Object.fromEntries((await db.query('select code, id from public.channels where workspace_id = $1 and code is not null', [ws])).rows.map((r) => [r.code, r.id]));
  otherChannel = (await as(other, 'select id from public.channels limit 1'))[0].id;
});

after(() => db.end());

test('채널·월별 광고비 저장, 고치기, 지우기', async () => {
  const saved = await one(admin, 'select public.save_ad_spend($1, $2)', ['2026-09-17', JSON.stringify([
    { channel_id: ch.naver_sa, amount: 1200000 }, { channel_id: ch.meta_ads, amount: 500000 }, { channel_id: ch.google_ads, amount: null },
  ])]);
  assert.equal(saved, 2);
  let m = await month(admin, '2026-09-01');
  assert.equal(m.month, '2026-09-01', '그 달 1일로 맞춤');
  assert.equal(amountOf(m, 'naver_sa'), 1200000);
  assert.equal(amountOf(m, 'google_ads'), null);

  await one(admin, 'select public.save_ad_spend($1, $2)', ['2026-09-01', JSON.stringify([{ channel_id: ch.naver_sa, amount: 1300000 }, { channel_id: ch.meta_ads, amount: null }])]);
  m = await month(admin, '2026-09-01');
  assert.equal(amountOf(m, 'naver_sa'), 1300000);
  assert.equal(amountOf(m, 'meta_ads'), null);
  await assert.rejects(as(admin, 'select public.save_ad_spend($1, $2)', ['2026-09-01', JSON.stringify([{ channel_id: ch.naver_sa, amount: -1 }])]), /check constraint/);
});

test('지난 달 복사: 비어 있는 채널만 채우고 숨긴 채널은 빼기', async () => {
  await one(admin, 'select public.save_ad_spend($1, $2)', ['2026-07-01', JSON.stringify([
    { channel_id: ch.naver_sa, amount: 900000 }, { channel_id: ch.google_ads, amount: 300000 }, { channel_id: ch.kakao_ads, amount: 100000 },
  ])]);
  await one(admin, 'select public.save_ad_spend($1, $2)', ['2026-08-01', JSON.stringify([{ channel_id: ch.google_ads, amount: 350000 }])]);
  await as(admin, "update public.channels set hidden = true where id = $1", [ch.kakao_ads]);
  const copied = await one(admin, "select public.copy_prev_month_spend('2026-08-01')");
  assert.equal(copied, 1, '네이버만 복사 (구글은 이미 있고 카카오는 숨김)');
  const m = await month(admin, '2026-08-01');
  assert.equal(amountOf(m, 'naver_sa'), 900000);
  assert.equal(amountOf(m, 'google_ads'), 350000);
  assert.equal(amountOf(m, 'kakao_ads'), null);
  assert.equal(m.channels.find((c) => c.code === 'naver_sa').prev_amount, 900000);
  assert.equal(m.prev_total, 1300000);
  // 숨긴 채널은 목록 뒤로
  assert.equal(m.channels.at(-1).code, 'kakao_ads');
  await as(admin, "update public.channels set hidden = false where id = $1", [ch.kakao_ads]);
});

test('키워드 CSV 반영: 그 달 키워드를 파일 내용으로 바꾸고 네이버 월 광고비도 맞춤', async () => {
  const rows = [{ keyword: '투명교정', amount: 91800, clicks: 51, impressions: 3300 }, { keyword: '강남임플란트', amount: 161700, clicks: 77, impressions: 4120 }];
  let r = await one(admin, 'select public.import_keyword_spend($1, $2, true)', ['2026-09-01', JSON.stringify(rows)]);
  assert.deepEqual(r, { count: 2, total: 253500 });
  let m = await month(admin, '2026-09-01');
  assert.deepEqual(m.keywords.map((k) => [k.keyword, k.amount]), [['강남임플란트', 161700], ['투명교정', 91800]]);
  assert.equal(m.keyword_total, 253500);
  assert.equal(amountOf(m, 'naver_sa'), 253500);

  // 다시 올리면 바뀐다 (앞 파일의 키워드가 남지 않음), 채널 금액은 그대로 두기
  r = await one(admin, 'select public.import_keyword_spend($1, $2, false)', ['2026-09-01', JSON.stringify([{ keyword: '라미네이트', amount: 50000, clicks: null, impressions: null }])]);
  assert.deepEqual(r, { count: 1, total: 50000 });
  m = await month(admin, '2026-09-01');
  assert.deepEqual(m.keywords.map((k) => k.keyword), ['라미네이트']);
  assert.equal(amountOf(m, 'naver_sa'), 253500);

  await one(admin, "select public.save_keyword_spend('2026-09-01', ' 치아미백 ', 20000, 5)");
  await one(admin, "select public.save_keyword_spend('2026-09-01', '치아미백', 25000)");
  m = await month(admin, '2026-09-01');
  assert.deepEqual(m.keywords.find((k) => k.keyword === '치아미백'), { keyword: '치아미백', amount: 25000, clicks: null, impressions: null });
  assert.equal(await one(admin, "select public.delete_keyword_spend('2026-09-01', '치아미백')"), 1);
  assert.equal(await one(admin, "select public.delete_keyword_spend('2026-09-01')"), 1);
  assert.equal((await month(admin, '2026-09-01')).keywords.length, 0);
});

test('채널 추가·이름 변경·숨기기·utm 매핑', async () => {
  const id = await one(admin, "select public.add_channel(' 당근 광고 ', 'paid', array['Daangn', ' daangn ', ''])");
  let c = (await db.query('select * from public.channels where id = $1', [id])).rows[0];
  assert.deepEqual([c.name, c.kind, c.utm_sources, c.code], ['당근 광고', 'paid', ['daangn'], null]);
  await assert.rejects(as(admin, "select public.add_channel('당근 광고', 'paid')"), /같은 이름의 채널/);
  await assert.rejects(as(admin, "select public.add_channel('이상한', 'free_paid')"), /check constraint/);

  await one(admin, "select public.update_channel($1, '당근마켓 광고', 'paid', array['daangn','karrot'], true)", [id]);
  c = (await db.query('select * from public.channels where id = $1', [id])).rows[0];
  assert.deepEqual([c.name, c.utm_sources, c.hidden], ['당근마켓 광고', ['daangn', 'karrot'], true]);
  await assert.rejects(as(admin, "select public.update_channel($1, '구글 광고', 'paid', '{}', false)", [id]), /같은 이름의 채널/);
  await assert.rejects(as(admin, "select public.update_channel($1, 'x', 'paid', '{}', false)", [otherChannel]), /찾을 수 없어요/);
});

test('직원과 다른 사업장은 광고비를 보거나 고칠 수 없다', async () => {
  for (const sql of [
    "select public.spend_month('2026-09-01')",
    "select public.save_ad_spend('2026-09-01', '[]')",
    "select public.copy_prev_month_spend('2026-09-01')",
    "select public.import_keyword_spend('2026-09-01', '[]')",
    "select public.add_channel('직원채널', 'paid')",
  ]) {
    await assert.rejects(as(staff, sql), /관리자만/, sql);
  }
  assert.equal((await as(staff, 'select * from public.ad_spend')).length, 0);
  assert.equal((await as(staff, 'select * from public.keyword_spend')).length, 0);

  // 다른 사업장 관리자: 자기 사업장 광고비만, 남의 채널에는 못 넣음
  assert.equal((await as(other, 'select * from public.ad_spend')).length, 0);
  await assert.rejects(as(other, 'select public.save_ad_spend($1, $2)', ['2026-09-01', JSON.stringify([{ channel_id: ch.naver_sa, amount: 1 }])]), /이 사업장의 채널이 아니에요/);
  assert.equal(amountOf(await month(admin, '2026-09-01'), 'naver_sa'), 253500);
});
