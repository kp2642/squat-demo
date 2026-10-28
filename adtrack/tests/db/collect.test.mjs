// 2단계 수집 함수: 사이트 확인, 채널 결정, 같은 연락처 합치기, 스팸 방지, 실행 권한
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const owner = { id: randomUUID(), email: `collect-${Date.now()}@example.com` };
let ws;
let key;

async function asRole(role, sql, params) {
  await db.query('begin');
  try {
    await db.query(`set local role ${role}`);
    const r = await db.query(sql, params);
    await db.query('commit');
    return r.rows;
  } catch (err) {
    await db.query('rollback');
    throw err;
  }
}

const collectLead = (host, lead, visitor = randomUUID(), ip = randomUUID()) =>
  asRole('service_role', 'select public.collect_lead($1, $2, $3, $4, $5) as r', [key, host, visitor, ip, lead]).then((r) => r[0].r);

const leadOf = (id) => db.query('select l.*, c.code as channel_code, c.name as channel_name from public.leads l left join public.channels c on c.id = l.channel_id where l.id = $1', [id]).then((r) => r.rows[0]);

before(async () => {
  await db.connect();
  await db.query('insert into auth.users (id, email) values ($1, $2)', [owner.id, owner.email]);
  await db.query('begin');
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [owner.id]);
  await db.query('set local role authenticated');
  ws = (await db.query("select public.create_workspace('수집 테스트', 'legal', array['collect-test.kr']) as id")).rows[0].id;
  await db.query('commit');
  key = (await db.query('select tracking_key from public.workspaces where id = $1', [ws])).rows[0].tracking_key;
});

after(() => db.end());

test('등록된 도메인과 하위 도메인만 받는다', async () => {
  const lead = { phone_hash: 'h-domain', source: { code: 'direct' } };
  assert.deepEqual(await collectLead('evil.com', lead), { ok: false, reason: 'unknown_site' });
  assert.deepEqual(await collectLead('collect-test.kr.evil.com', lead), { ok: false, reason: 'unknown_site' });
  assert.deepEqual(await collectLead('notcollect-test.kr', lead), { ok: false, reason: 'unknown_site' });
  const wrongKey = await asRole('service_role', 'select public.collect_lead($1, $2, $3, $4, $5) as r', ['tk_' + '0'.repeat(32), 'collect-test.kr', 'v', 'i', lead]);
  assert.equal(wrongKey[0].r.reason, 'unknown_site');
  assert.equal((await collectLead('m.collect-test.kr', lead)).ok, true);
  const [site] = (await db.query('select verified_at from public.sites where workspace_id = $1', [ws])).rows;
  assert.ok(site.verified_at, '첫 신호로 설치 확인됨');
});

test('채널 결정: 기본 채널 code, utm_source 매핑, 매핑 없음', async () => {
  const naver = await collectLead('collect-test.kr', { phone_hash: 'h1', source: { code: 'naver_sa', keyword: '이혼', evidence: 'n_keyword=이혼' } });
  const l1 = await leadOf(naver.lead_id);
  assert.equal(l1.channel_code, 'naver_sa');
  assert.equal(l1.attribution, 'auto');
  assert.equal(l1.keyword, '이혼');
  assert.equal(l1.evidence, 'n_keyword=이혼');
  assert.equal(l1.method, 'form');
  assert.equal(l1.status, 'new');

  const insta = await collectLead('collect-test.kr', { phone_hash: 'h2', source: { utm_source: 'instagram', campaign: '봄' } });
  assert.equal((await leadOf(insta.lead_id)).channel_code, 'meta_ads');

  const unknown = await collectLead('collect-test.kr', { phone_hash: 'h3', source: { utm_source: 'newsletter' } });
  const l3 = await leadOf(unknown.lead_id);
  assert.equal(l3.channel_id, null);
  assert.equal(l3.attribution, 'unknown');

  // 사업장이 직접 추가한 채널에 utm 값을 매핑하면 그 채널로
  await db.query("insert into public.channels (workspace_id, name, kind, utm_sources) values ($1, '뉴스레터', 'free', array['newsletter'])", [ws]);
  const mapped = await collectLead('collect-test.kr', { phone_hash: 'h4', source: { utm_source: 'newsletter' } });
  assert.equal((await leadOf(mapped.lead_id)).channel_name, '뉴스레터');
});

test('같은 연락처는 새 문의 대신 다시 연락으로, 출처는 첫 문의 것 유지', async () => {
  const first = await collectLead('collect-test.kr', { phone_hash: 'same', source: { code: 'blog' } });
  const again = await collectLead('collect-test.kr', { phone_hash: 'same', source: { code: 'google_ads', evidence: 'gclid=x' } });
  assert.equal(again.merged, true);
  assert.equal(again.lead_id, first.lead_id);
  assert.equal((await leadOf(first.lead_id)).channel_code, 'blog');
  const touches = (await db.query('select t.evidence, c.code from public.lead_touches t join public.channels c on c.id = t.channel_id where lead_id = $1', [first.lead_id])).rows;
  assert.deepEqual(touches, [{ evidence: 'gclid=x', code: 'google_ads' }]);
  const count = (await db.query("select count(*)::int as n from public.leads where workspace_id = $1 and phone_hash = 'same'", [ws])).rows[0].n;
  assert.equal(count, 1);
});

test('같은 연락처가 동시에 들어와도 문의는 하나', async () => {
  const clients = await Promise.all([1, 2, 3, 4, 5].map(async () => {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    return c;
  }));
  const results = await Promise.all(clients.map((c, i) =>
    c.query('select public.collect_lead($1, $2, $3, $4, $5) as r', [key, 'collect-test.kr', `race-${i}`, `ip-${i}`, { phone_hash: 'race', source: { code: 'direct' } }])
      .then((r) => r.rows[0].r)));
  await Promise.all(clients.map((c) => c.end()));
  assert.equal(new Set(results.map((r) => r.lead_id)).size, 1);
  assert.equal(results.filter((r) => !r.merged).length, 1);
});

test('문의 완료 페이지 방식: 연락처 없이도 문의로 센다 (합치지 않음)', async () => {
  const a = await collectLead('collect-test.kr', { source: { code: 'direct' } });
  const b = await collectLead('collect-test.kr', { source: { code: 'direct' } });
  assert.notEqual(a.lead_id, b.lead_id);
  assert.equal((await leadOf(a.lead_id)).phone_hash, null);
});

test('같은 방문자 10분에 3건, 같은 IP 10분에 20건까지', async () => {
  const visitor = randomUUID();
  const ip = randomUUID();
  const results = [];
  for (let i = 0; i < 4; i++) results.push(await collectLead('collect-test.kr', { phone_hash: `spam-${i}`, source: { code: 'direct' } }, visitor, ip));
  assert.deepEqual(results.map((r) => r.ok), [true, true, true, false]);
  assert.equal(results[3].reason, 'rate_limited');

  const ip2 = randomUUID();
  let blocked = 0;
  for (let i = 0; i < 22; i++) {
    const r = await collectLead('collect-test.kr', { phone_hash: `ip-${i}`, source: { code: 'direct' } }, randomUUID(), ip2);
    if (!r.ok) blocked++;
  }
  assert.equal(blocked, 2);
});

test('수집 함수는 서버(service_role)만 실행할 수 있다', async () => {
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(asRole(role, 'select public.collect_lead($1, $2, $3, $4, $5)', [key, 'collect-test.kr', 'v', 'i', {}]), /permission denied/);
    await assert.rejects(asRole(role, 'select public.collect_hello($1, $2)', [key, 'collect-test.kr']), /permission denied/);
    await assert.rejects(asRole(role, 'select public.tracker_config($1)', [key]), /permission denied/);
    await assert.rejects(asRole(role, 'select public.rate_limit_hit($1, 1, 1)', ['x']), /permission denied/);
    await assert.rejects(asRole(role, 'select * from public.rate_limits'), /permission denied/);
  }
});

test('방문 기록은 꼬리표가 있을 때 저장되고 관리자만 본다', async () => {
  const r = await asRole('service_role', 'select public.collect_visit($1, $2, $3, $4, $5, $6) as r', [key, 'collect-test.kr', 'vis', { n_media: '1' }, 'https://search.naver.com/', '/']);
  assert.equal(r[0].r.ok, true);
  const tracker = await asRole('service_role', 'select public.tracker_config($1) as c', [key]);
  assert.deepEqual(tracker[0].c, { thankYouUrl: null });
});
