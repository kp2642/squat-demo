// 3단계 문의함: 상태·금액·실패 사유, 출처 수정, 고객 응답, 직접 등록, 검색, 변경 기록, 권한
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const admin = { id: randomUUID(), email: `inbox-admin-${Date.now()}@example.com` };
const staff = { id: randomUUID(), email: `inbox-staff-${Date.now()}@example.com` };
const other = { id: randomUUID(), email: `inbox-other-${Date.now()}@example.com` };
let ws;
let key;
let channels; // code → id
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

async function webLead(phoneHash, source = { code: 'naver_sa', evidence: 'n_keyword=교통사고', keyword: '교통사고' }, extra = {}) {
  const r = await db.query('select public.collect_lead($1, $2, $3, $4, $5) as r',
    [key, 'inbox-test.kr', randomUUID(), randomUUID(), { phone_hash: phoneHash, phone_masked: phoneHash && `010-****-${phoneHash.slice(-4)}`, source, ...extra }]);
  return r.rows[0].r.lead_id;
}
const events = (leadId) => db.query('select field, old_value, new_value, user_id from public.lead_events where lead_id = $1 order by seq', [leadId]).then((r) => r.rows);
const lead = (id) => db.query('select * from public.leads where id = $1', [id]).then((r) => r.rows[0]);

before(async () => {
  await db.connect();
  for (const u of [admin, staff, other]) await db.query('insert into auth.users (id, email) values ($1, $2)', [u.id, u.email]);
  ws = await one(admin, "select public.create_workspace('문의함 테스트', 'legal', array['inbox-test.kr'], '관리자')");
  await one(other, "select public.create_workspace('다른 곳', 'clinic', array['other-inbox.kr'])");
  await db.query("insert into public.users (id, workspace_id, email, name, role) values ($1, $2, $3, '상담실장', 'staff')", [staff.id, ws, staff.email]);
  key = (await db.query('select tracking_key from public.workspaces where id = $1', [ws])).rows[0].tracking_key;
  channels = Object.fromEntries((await db.query('select code, id from public.channels where workspace_id = $1 and code is not null', [ws])).rows.map((r) => [r.code, r.id]));
  otherChannel = (await as(other, 'select id from public.channels limit 1'))[0].id;
  await as(admin, "update public.channels set coupon_codes = array['블로그 보고 왔어요', 'BLOG10'] where code = 'blog'");
});

after(() => db.end());

test('계약은 금액이 있어야 하고, 상태가 바뀌면 시각·기록이 남는다', async () => {
  const id = await webLead('h-status-0001');
  await assert.rejects(as(staff, "select public.update_lead_status($1, 'contracted')", [id]), /계약 금액/);
  const updated = await one(staff, "select public.update_lead_status($1, 'contracted', 3000000)", [id]);
  assert.equal(updated.status, 'contracted');
  assert.equal(Number(updated.contract_amount), 3000000);
  assert.equal(updated.channel_name, '네이버 검색광고');
  assert.ok((await lead(id)).status_changed_at);

  // 실패로 바꾸면 금액은 지워지고 사유가 남는다
  await one(staff, "select public.update_lead_status($1, 'failed', 3000000, '가격')", [id]);
  const l = await lead(id);
  assert.equal(l.contract_amount, null);
  assert.equal(l.fail_reason, '가격');
  await assert.rejects(as(staff, "select public.update_lead_status($1, 'failed', null, '몰라요')", [id]), /check constraint/);

  const ev = await events(id);
  assert.deepEqual(ev.map((e) => [e.field, e.old_value, e.new_value]), [
    ['status', 'new', 'contracted'],
    ['contract_amount', null, '3000000'],
    ['status', 'contracted', 'failed'],
    ['contract_amount', '3000000', null],
    ['fail_reason', null, '가격'],
  ]);
  assert.ok(ev.every((e) => e.user_id === staff.id), '누가 바꿨는지');
});

test('출처를 바꾸면 직접 선택으로 표시되고 원래 값은 기록에 남는다', async () => {
  const id = await webLead('h-source-0002');
  const r = await one(staff, 'select public.update_lead_channel($1, $2)', [id, channels.referral]);
  assert.equal(r.attribution, 'manual');
  assert.equal(r.channel_name, '지인 소개');
  const l = await lead(id);
  assert.equal(l.keyword, '교통사고', '자동 판별 근거는 그대로');
  assert.equal(l.evidence, 'n_keyword=교통사고');
  assert.deepEqual((await events(id)).map((e) => [e.field, e.old_value, e.new_value]), [
    ['channel', '네이버 검색광고', '지인 소개'],
    ['attribution', 'auto', 'manual'],
  ]);
  await assert.rejects(as(staff, 'select public.update_lead_channel($1, $2)', [id, otherChannel]), /이 사업장의 채널이 아니에요/);
});

test('자동 판별된 문의에 고객 응답을 남겨도 출처는 자동 판별을 따른다', async () => {
  const id = await webLead('h-asked-0003', { code: 'meta_ads', evidence: 'fbclid=x' });
  const r = await one(staff, 'select public.update_lead_asked($1, $2)', [id, channels.naver_sa]);
  assert.equal(r.channel_name, '메타 광고');
  assert.equal(r.asked_channel_name, '네이버 검색광고');
  assert.equal(r.attribution, 'auto');
});

test('직접 등록: 유입경로 필수, 쿠폰 문구는 채널 자동 선택, 같은 연락처는 다시 연락', async () => {
  await assert.rejects(as(staff, "select public.create_manual_lead('call', null)"), /어떻게 알고 오셨는지/);
  await assert.rejects(as(staff, "select public.create_manual_lead('form', $1)", [channels.referral]), /문의 방식/);
  await assert.rejects(as(staff, "select public.create_manual_lead('call', $1)", [otherChannel]), /이 사업장의 채널이 아니에요/);

  const asked = await one(staff, "select public.create_manual_lead('call', $1, null, 'enc-n', 'nh-1', 'enc-p', 'ph-manual-1', '010-****-1111', '이혼')", [channels.referral]);
  const l1 = await lead(asked.lead_id);
  assert.deepEqual([l1.method, l1.attribution, l1.channel_id, l1.asked_channel_id, l1.evidence], ['call', 'asked', channels.referral, channels.referral, '고객 응답']);
  assert.deepEqual((await events(asked.lead_id)).map((e) => [e.field, e.new_value, e.user_id]), [['created', 'call', staff.id]]);

  // 쿠폰 문구가 맞으면 고른 채널보다 우선 (대소문자·앞뒤 공백 무시)
  const coupon = await one(staff, "select public.create_manual_lead('walkin', $1, '  blog10 ', null, null, 'enc-p2', 'ph-manual-2', '010-****-2222')", [channels.direct]);
  const l2 = await lead(coupon.lead_id);
  assert.deepEqual([l2.attribution, l2.channel_id, l2.coupon_code, l2.evidence], ['coupon', channels.blog, 'blog10', '쿠폰 문구 blog10']);
  // 맞는 쿠폰이 없으면 고른 채널
  const noMatch = await one(staff, "select public.create_manual_lead('etc', $1, '모르는문구')", [channels.organic]);
  assert.equal((await lead(noMatch.lead_id)).attribution, 'asked');

  // 이미 홈페이지로 문의했던 번호로 전화가 오면
  const webId = await webLead('ph-dup-3333');
  const dup = await one(staff, "select public.create_manual_lead('call', $1, null, null, null, 'enc', 'ph-dup-3333', '010-****-3333')", [channels.referral]);
  assert.deepEqual(dup, { lead_id: webId, merged: true });
  const touches = (await db.query('select method, evidence from public.lead_touches where lead_id = $1', [webId])).rows;
  assert.deepEqual(touches, [{ method: 'call', evidence: '고객 응답' }]);
  assert.equal((await lead(webId)).channel_id, channels.naver_sa, '출처는 첫 문의 것');
});

test('연락처를 다른 문의와 같은 번호로 바꾸면 막는다', async () => {
  const a = await webLead('ph-contact-4444');
  const b = await webLead(null, { code: 'direct' });
  await assert.rejects(
    as(staff, "select public.update_lead_contact($1, 'n', 'nh', 'p', 'ph-contact-4444', '010-****-4444', '형사')", [b]),
    /같은 연락처의 문의가 이미 있어요/);
  const r = await one(staff, "select public.update_lead_contact($1, 'n', 'nh-new', 'p', 'ph-contact-5555', '010-****-5555', '형사')", [b]);
  assert.equal(r.phone_masked, '010-****-5555');
  assert.deepEqual((await events(b)).map((e) => [e.field, e.old_value, e.new_value]), [
    ['name', null, null], ['phone', null, '010-****-5555'], ['inquiry_type', null, '형사'],
  ]);
  assert.ok(a);
});

test('목록: 상태·채널·출처 미확인 필터, 이름·번호·뒷자리 검색, 페이지', async () => {
  await webLead('ph-list-7777', { code: 'google_ads' }, { name_hash: 'name-hong' });
  await webLead('ph-list-8888', { utm_source: 'nowhere' });
  const all = await one(staff, 'select public.inbox_list()');
  const count = (await db.query('select count(*)::int as n from public.leads where workspace_id = $1', [ws])).rows[0].n;
  assert.equal(all.total, count);
  assert.ok(all.items.length <= 30);
  const dates = all.items.map((i) => i.created_at);
  assert.deepEqual([...dates].sort().reverse(), dates, '최신순');
  assert.ok(all.items.every((i) => !('phone_hash' in i) && !('name_hash' in i)));

  const google = await one(staff, 'select public.inbox_list(p_channel => $1)', [channels.google_ads]);
  assert.ok(google.items.length >= 1 && google.items.every((i) => i.channel_code === 'google_ads'));
  const none = await one(staff, "select public.inbox_list(p_channel => 'none')");
  assert.ok(none.items.length >= 1 && none.items.every((i) => i.channel_id === null));
  const failed = await one(staff, "select public.inbox_list(p_status => 'failed')");
  assert.ok(failed.items.every((i) => i.status === 'failed') && failed.total >= 1);

  assert.equal((await one(staff, "select public.inbox_list(p_name_hash => 'name-hong')")).total, 1);
  assert.equal((await one(staff, "select public.inbox_list(p_phone_hash => 'ph-list-8888')")).total, 1);
  assert.equal((await one(staff, "select public.inbox_list(p_last4 => '7777')")).total, 1);

  const page2 = await one(staff, 'select public.inbox_list(p_limit => 2, p_offset => 2)');
  assert.equal(page2.items.length, 2);
  assert.equal(page2.items[0].id, all.items[2].id);

  const newCount = await one(staff, 'select public.inbox_new_count()');
  assert.equal(newCount, (await one(staff, "select public.inbox_list(p_status => 'new')")).total);
});

test('상세: 다시 연락·변경 기록·첫 유입', async () => {
  const id = await webLead('ph-detail-9999', { code: 'blog', evidence: '유입 주소 blog.naver.com' }, { first_touch: { t: {}, r: 'https://blog.naver.com/x' } });
  await one(staff, "select public.create_manual_lead('call', $1, null, null, null, 'e', 'ph-detail-9999', '010-****-9999')", [channels.referral]);
  await one(staff, "select public.update_lead_status($1, 'consulting')", [id]);
  const d = await one(staff, 'select public.lead_detail($1)', [id]);
  assert.equal(d.touches, 1);
  assert.equal(d.touch_list[0].channel_name, '지인 소개');
  assert.deepEqual(d.events.map((e) => [e.field, e.user_name]), [['status', '상담실장']]);
  assert.equal(d.first_touch.r, 'https://blog.naver.com/x');
});

test('다른 사업장의 문의는 읽거나 바꾸거나 지울 수 없다', async () => {
  const id = await webLead('ph-secret-1212');
  assert.equal(await one(other, 'select public.lead_detail($1)', [id]), null);
  assert.equal((await one(other, 'select public.inbox_list()')).items.some((i) => i.id === id), false);
  await assert.rejects(as(other, "select public.update_lead_status($1, 'failed', null, '기타')", [id]), /찾을 수 없어요/);
  await assert.rejects(as(other, 'select public.update_lead_channel($1, null)', [id]), /찾을 수 없어요/);
  assert.equal(await one(other, 'select public.delete_lead($1)', [id]), false);
  assert.equal(await one(other, 'select public.channel_name($1)', [channels.naver_sa]), null);
  assert.equal((await lead(id)).status, 'new');
});

test('직원은 문의를 지울 수 없고 관리자는 지울 수 있다', async () => {
  const id = await webLead('ph-delete-1313');
  assert.equal(await one(staff, 'select public.delete_lead($1)', [id]), false);
  assert.equal(await one(admin, 'select public.delete_lead($1)', [id]), true);
  assert.equal(await lead(id), undefined);
});

test('판별 방식·근거·변경 기록은 화면을 거치지 않고 직접 고칠 수 없다', async () => {
  const id = await webLead('ph-direct-1414');
  await assert.rejects(as(staff, "update public.leads set attribution = 'auto' where id = $1", [id]), /permission denied/);
  await assert.rejects(as(staff, "update public.leads set evidence = 'x' where id = $1", [id]), /permission denied/);
  await assert.rejects(as(staff, "insert into public.lead_events (workspace_id, lead_id, field) values ($1, $2, 'status')", [ws, id]), /permission denied/);
  await assert.rejects(as(staff, 'delete from public.lead_events where lead_id = $1', [id]), /permission denied/);
  // 쿠폰 문구는 관리자만 바꾼다 (직원은 수정 정책이 없어 0행)
  await as(staff, "update public.channels set coupon_codes = array['x']");
  const r = await db.query("select coupon_codes from public.channels where workspace_id = $1 and code = 'blog'", [ws]);
  assert.deepEqual(r.rows[0].coupon_codes, ['블로그 보고 왔어요', 'BLOG10']);
});
