// 1단계 완료 기준: 두 사업장을 만들었을 때 서로의 데이터가 절대 보이지 않음.
// scripts/test-db.sh 가 마이그레이션을 적용한 DB 에 대해 실행한다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });

const ownerA = { id: randomUUID(), email: 'owner-a@example.com' };
const ownerB = { id: randomUUID(), email: 'owner-b@example.com' };
const staffA = { id: randomUUID(), email: 'staff-a@example.com' };
const outsider = { id: randomUUID(), email: 'outsider@example.com' };
let wsA;
let wsB;

// 한 사용자로 로그인한 것처럼 트랜잭션 하나를 실행한다. user 가 null 이면 비로그인(anon).
async function as(user, fn) {
  await db.query('begin');
  try {
    if (user) {
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user.id]);
      await db.query('set local role authenticated');
    } else {
      await db.query('set local role anon');
    }
    const result = await fn((sql, params) => db.query(sql, params));
    await db.query('commit');
    return result;
  } catch (err) {
    await db.query('rollback');
    throw err;
  }
}

const rows = (user, sql, params) => as(user, (q) => q(sql, params)).then((r) => r.rows);
const count = (user, sql, params) => as(user, (q) => q(sql, params)).then((r) => r.rowCount);

// workspace_id 열이 있는 모든 public 테이블 (나중에 테이블이 늘어도 자동으로 검사 대상이 됨)
async function workspaceTables() {
  const { rows: r } = await db.query(`
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'workspace_id' order by table_name`);
  return r.map((x) => x.table_name);
}

before(async () => {
  await db.connect();
  for (const u of [ownerA, ownerB, staffA, outsider]) {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [u.id, u.email]);
  }
  [{ ws: wsA }] = await rows(ownerA, "select public.create_workspace('A 법률사무소', 'legal', array['https://www.a-law.kr/contact', 'a-law.co.kr'], '김대표') as ws");
  [{ ws: wsB }] = await rows(ownerB, "select public.create_workspace('B 치과', 'clinic', array['b-dental.com'], '이원장') as ws");

  const [{ token }] = await rows(ownerA, "insert into public.invitations (workspace_id, email) values ($1, 'staff-a@example.com') returning token", [wsA]);
  await rows(staffA, 'select public.accept_invitation($1, $2)', [token, '박직원']);
  // B 에도 초대를 하나 남겨 둔다 (A 쪽에서 보이면 안 됨)
  await rows(ownerB, "insert into public.invitations (workspace_id, email) values ($1, 'someone@example.com')", [wsB]);

  // 양쪽 사업장에 문의·다시 연락·방문 기록을 만든다 (수집 함수는 서버만 부를 수 있음)
  for (const [owner, host] of [[ownerA, 'www.a-law.kr'], [ownerB, 'b-dental.com']]) {
    const [{ tracking_key: key }] = await rows(owner, 'select tracking_key from public.workspaces');
    const lead = { phone_hash: `hash-${host}`, phone_masked: '010-****-0000', source: { code: 'naver_sa', evidence: 'n_media=1' } };
    await db.query('select public.collect_lead($1, $2, $3, $4, $5)', [key, host, 'v1', 'ip1', lead]);
    await db.query('select public.collect_lead($1, $2, $3, $4, $5)', [key, host, 'v2', 'ip1', lead]);
    await db.query('select public.collect_visit($1, $2, $3, $4, $5, $6)', [key, host, 'v1', { gclid: 'g' }, null, '/']);
  }
});

after(async () => {
  await db.end();
});

test('모든 public 테이블에 RLS 가 켜져 있다', async () => {
  const { rows: r } = await db.query(`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
  assert.deepEqual(r, []);
});

test('사업장을 만들면 업종 프리셋과 기본 채널, 사이트가 채워진다', async () => {
  const [ws] = await rows(ownerA, 'select * from public.workspaces');
  assert.equal(ws.id, wsA);
  assert.equal(ws.contract_term, '수임');
  assert.equal(Number(ws.avg_contract_amount), 3000000);
  assert.match(ws.tracking_key, /^tk_[0-9a-f]{32}$/);

  const types = await rows(ownerA, 'select name from public.inquiry_types order by position');
  assert.deepEqual(types.map((t) => t.name), ['이혼', '형사', '민사', '상속', '기업 자문', '기타']);

  const channels = await rows(ownerA, 'select code from public.channels');
  assert.equal(channels.length, 9);

  const sites = await rows(ownerA, 'select domain from public.sites order by domain');
  assert.deepEqual(sites.map((s) => s.domain), ['a-law.co.kr', 'a-law.kr']);

  const [me] = await rows(ownerA, 'select role, name, email from public.users where id = auth.uid()');
  assert.deepEqual(me, { role: 'admin', name: '김대표', email: 'owner-a@example.com' });
});

test('각 사업장 사용자는 모든 테이블에서 자기 사업장 행만 본다', async () => {
  const tables = await workspaceTables();
  assert.ok(tables.length >= 5, `검사할 테이블: ${tables}`);
  for (const [user, mine, other] of [[ownerA, wsA, wsB], [ownerB, wsB, wsA], [staffA, wsA, wsB]]) {
    for (const t of tables) {
      const r = await rows(user, `select workspace_id from public.${t}`);
      assert.ok(r.every((x) => x.workspace_id === mine), `${user.email} 가 ${t} 에서 다른 사업장 행을 봄`);
      const leaked = await rows(user, `select 1 from public.${t} where workspace_id = $1`, [other]);
      assert.equal(leaked.length, 0, `${user.email} → ${t}`);
    }
    const ws = await rows(user, 'select id from public.workspaces');
    assert.deepEqual(ws.map((w) => w.id), [mine]);
  }
});

test('id 를 알아도 다른 사업장 데이터는 읽을 수 없다', async () => {
  const [bChannel] = await rows(ownerB, 'select id from public.channels limit 1');
  assert.equal((await rows(ownerA, 'select * from public.channels where id = $1', [bChannel.id])).length, 0);
  assert.equal((await rows(ownerA, 'select * from public.workspaces where id = $1', [wsB])).length, 0);
  assert.equal((await rows(ownerA, 'select * from public.users where id = $1', [ownerB.id])).length, 0);
});

test('다른 사업장 데이터는 수정·삭제·추가할 수 없다', async () => {
  const [bChannel] = await rows(ownerB, 'select id from public.channels where code is null or true limit 1');
  const [bSite] = await rows(ownerB, 'select id from public.sites limit 1');

  assert.equal(await count(ownerA, "update public.workspaces set name = '해킹' where id = $1", [wsB]), 0);
  assert.equal(await count(ownerA, "update public.channels set name = '해킹' where id = $1", [bChannel.id]), 0);
  assert.equal(await count(ownerA, "update public.sites set domain = 'evil.com' where id = $1", [bSite.id]), 0);
  assert.equal(await count(ownerA, 'delete from public.sites where id = $1', [bSite.id]), 0);
  assert.equal(await count(ownerA, 'delete from public.users where id = $1', [ownerB.id]), 0);
  assert.equal(await count(ownerA, 'delete from public.invitations where workspace_id = $1', [wsB]), 0);

  await assert.rejects(rows(ownerA, "insert into public.channels (workspace_id, name, kind) values ($1, '몰래', 'paid')", [wsB]), /row-level security/);
  await assert.rejects(rows(ownerA, "insert into public.sites (workspace_id, domain) values ($1, 'evil.com')", [wsB]), /row-level security/);
  await assert.rejects(rows(ownerA, "insert into public.inquiry_types (workspace_id, name) values ($1, '몰래')", [wsB]), /row-level security/);
  await assert.rejects(rows(ownerA, "insert into public.invitations (workspace_id, email) values ($1, 'x@example.com')", [wsB]), /row-level security/);

  // 자기 행을 다른 사업장으로 옮기는 것도 막힌다
  const [aChannel] = await rows(ownerA, 'select id from public.channels limit 1');
  await assert.rejects(rows(ownerA, 'update public.channels set workspace_id = $1 where id = $2', [wsB, aChannel.id]), /permission denied/);

  const [stillB] = await rows(ownerB, 'select name from public.workspaces');
  assert.equal(stillB.name, 'B 치과');
});

test('비로그인 사용자는 업종 프리셋 외에는 아무것도 볼 수 없다', async () => {
  assert.ok((await rows(null, 'select * from public.industry_presets')).length >= 5);
  for (const t of await workspaceTables()) {
    await assert.rejects(rows(null, `select * from public.${t}`), /permission denied/);
  }
  await assert.rejects(rows(null, 'select * from public.workspaces'), /permission denied/);
  await assert.rejects(rows(null, "select public.create_workspace('x', 'legal')"), /permission denied/);
});

test('사업장이 없는 로그인 사용자는 아무 사업장 데이터도 볼 수 없다', async () => {
  for (const t of [...(await workspaceTables()), 'workspaces']) {
    assert.equal((await rows(outsider, `select * from public.${t}`)).length, 0, t);
  }
});

test('직원은 문의 등록에 필요한 것만 읽고 설정은 바꿀 수 없다', async () => {
  const [me] = await rows(staffA, 'select role, name from public.users where id = auth.uid()');
  assert.deepEqual(me, { role: 'staff', name: '박직원' });
  assert.equal((await rows(staffA, 'select * from public.channels')).length, 9);
  assert.equal((await rows(staffA, 'select * from public.inquiry_types')).length, 6);
  assert.equal((await rows(staffA, 'select * from public.invitations')).length, 0);

  assert.equal(await count(staffA, "update public.workspaces set name = 'x'"), 0);
  assert.equal(await count(staffA, "update public.channels set hidden = true"), 0);
  assert.equal(await count(staffA, 'delete from public.users where id = $1', [ownerA.id]), 0);
  await assert.rejects(rows(staffA, "insert into public.channels (workspace_id, name, kind) values ($1, '몰래', 'paid')", [wsA]), /row-level security/);
  await assert.rejects(rows(staffA, "insert into public.invitations (workspace_id, email) values ($1, 'x@example.com')", [wsA]), /row-level security/);
  // 자기 역할을 관리자로 올릴 수 없다 (이름만 수정 가능)
  await assert.rejects(rows(staffA, "update public.users set role = 'admin' where id = auth.uid()"), /permission denied/);
  assert.equal(await count(staffA, "update public.users set name = '박상담' where id = auth.uid()"), 1);
  assert.equal(await count(staffA, "update public.users set name = 'x' where id = $1", [ownerA.id]), 0);
});

test('추적 키와 사업장 id 는 바꿀 수 없다', async () => {
  await assert.rejects(rows(ownerA, "update public.workspaces set tracking_key = 'tk_x'"), /permission denied/);
  await assert.rejects(rows(ownerA, 'update public.workspaces set id = gen_random_uuid()'), /permission denied/);
  assert.equal(await count(ownerA, "update public.workspaces set contract_term = '선임', avg_contract_amount = 2500000"), 1);
});

test('초대: 토큰·이메일·만료·중복 소속을 확인한다', async () => {
  const [{ token }] = await rows(ownerA, "insert into public.invitations (workspace_id, email, role) values ($1, 'new@example.com', 'staff') returning token, invited_by", [wsA]);
  const [inv] = await rows(ownerA, 'select invited_by from public.invitations where token = $1', [token]);
  assert.equal(inv.invited_by, ownerA.id);

  // 비로그인 상태로 초대 정보 확인 가능 (토큰을 알 때만)
  const [info] = await rows(null, 'select * from public.get_invitation($1)', [token]);
  assert.deepEqual(info, { workspace_name: 'A 법률사무소', email: 'new@example.com', role: 'staff', expired: false, accepted: false });
  assert.equal((await rows(null, "select * from public.get_invitation('없는토큰')")).length, 0);

  // 다른 이메일로는 수락할 수 없다
  await assert.rejects(rows(outsider, 'select public.accept_invitation($1)', [token]), /초대받은 이메일/);
  // 이미 B 사업장에 속한 사람도 수락할 수 없다
  const newbie = { id: randomUUID(), email: 'new@example.com' };
  await db.query('insert into auth.users (id, email) values ($1, $2)', [newbie.id, 'New@Example.com']);
  await rows(newbie, 'select public.accept_invitation($1)', [token]);
  await assert.rejects(rows(newbie, 'select public.accept_invitation($1)', [token]), /이미 사용된/);
  const ws = await rows(newbie, 'select id from public.workspaces');
  assert.deepEqual(ws.map((w) => w.id), [wsA]);

  // 만료된 초대
  const [{ token: old }] = await rows(ownerA, "insert into public.invitations (workspace_id, email) values ($1, 'outsider@example.com') returning token", [wsA]);
  await db.query("update public.invitations set expires_at = now() - interval '1 minute' where token = $1", [old]);
  await assert.rejects(rows(outsider, 'select public.accept_invitation($1)', [old]), /만료/);

  // 이미 사업장이 있는 사람은 다른 사업장 초대를 받을 수 없다
  const [{ token: cross }] = await rows(ownerA, "insert into public.invitations (workspace_id, email) values ($1, 'owner-b@example.com') returning token", [wsA]);
  await assert.rejects(rows(ownerB, 'select public.accept_invitation($1)', [cross]), /이미 다른 사업장/);
  assert.deepEqual((await rows(ownerB, 'select id from public.workspaces')).map((w) => w.id), [wsB]);
});

test('한 사람이 사업장을 두 개 만들 수 없다', async () => {
  await assert.rejects(rows(ownerA, "select public.create_workspace('두 번째', 'tax')"), /이미 사업장/);
});

test('관리자가 직원을 삭제하면 그 직원은 더 이상 데이터를 볼 수 없다', async () => {
  const temp = { id: randomUUID(), email: 'temp@example.com' };
  await db.query('insert into auth.users (id, email) values ($1, $2)', [temp.id, temp.email]);
  const [{ token }] = await rows(ownerA, "insert into public.invitations (workspace_id, email) values ($1, 'temp@example.com') returning token", [wsA]);
  await rows(temp, 'select public.accept_invitation($1)', [token]);
  assert.equal((await rows(temp, 'select * from public.channels')).length, 9);

  assert.equal(await count(ownerA, 'delete from public.users where id = auth.uid()'), 0, '자기 자신은 삭제 불가');
  assert.equal(await count(ownerA, 'delete from public.users where id = $1', [temp.id]), 1);
  assert.equal((await rows(temp, 'select * from public.channels')).length, 0);
  assert.equal((await rows(temp, 'select * from public.workspaces')).length, 0);
});

test('기본 채널은 지울 수 없고 숨길 수만 있다', async () => {
  assert.equal(await count(ownerA, "delete from public.channels where code = 'naver_sa'"), 0);
  assert.equal(await count(ownerA, "update public.channels set hidden = true where code = 'kakao_ads'"), 1);
  await rows(ownerA, "insert into public.channels (workspace_id, name, kind) values ($1, '당근 광고', 'paid')", [wsA]);
  assert.equal(await count(ownerA, "delete from public.channels where name = '당근 광고'"), 1);
});
