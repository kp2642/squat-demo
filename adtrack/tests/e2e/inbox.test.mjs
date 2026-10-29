// 3단계 완료 기준: 휴대폰에서 문의 하나를 ‘계약 + 금액’으로 바꾸는 데 탭 3번 이하.
// 400px 폭 터치 화면으로 문의함을 실제로 써 본다. 로그인은 테스트 전용 서명 쿠키(src/lib/test-auth.ts)로 대신한다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import pg from 'pg';
import { chromium } from 'playwright';
import { startApp, waitFor } from './app.mjs';

process.env.LEAD_ENCRYPTION_KEY ??= Buffer.alloc(32, 3).toString('base64');
const { encrypt, nameHash, phoneHash } = await import('../../src/lib/crypto.ts');
const { maskPhone } = await import('../../src/lib/phone.ts');

const PORT = 3220;
const SECRET = 'e2e-test-auth-secret';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const admin = { id: randomUUID(), email: `inbox-e2e-admin-${Date.now()}@example.com` };
const staff = { id: randomUUID(), email: `inbox-e2e-staff-${Date.now()}@example.com` };
let app;
let browser;
let ws;
let key;
const channels = {};

// 홈페이지 문의 한 건을 수집 함수로 넣는다 (2단계 경로와 같은 모양)
async function webLead(name, phone, source) {
  const digits = phone.replace(/\D/g, '');
  const r = await db.query('select public.collect_lead($1, $2, $3, $4, $5) as r', [key, 'inbox-e2e.kr', randomUUID(), randomUUID(), {
    name_enc: encrypt(name), name_hash: nameHash(name),
    phone_enc: encrypt(phone), phone_hash: phoneHash(digits), phone_masked: maskPhone(digits),
    inquiry_type: '이혼', source,
  }]);
  return r.rows[0].r.lead_id;
}
const lead = (id) => db.query('select * from public.leads where id = $1', [id]).then((r) => r.rows[0]);

// 휴대폰 화면으로 로그인한 상태
async function phoneAs(user) {
  const context = await browser.newContext({ viewport: { width: 400, height: 800 }, isMobile: true, hasTouch: true, locale: 'ko-KR' });
  const sig = createHmac('sha256', SECRET).update(user.id).digest('base64url');
  await context.addCookies([{ name: 'adtrack_test_user', value: `${user.id}.${sig}`, url: app.url }]);
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  return { context, page };
}

// 탭 수를 세면서 누른다
function tapper(page) {
  let taps = 0;
  return {
    tap: async (locator) => { taps++; await locator.tap(); },
    get count() { return taps; },
  };
}

before(async () => {
  await db.connect();
  for (const u of [admin, staff]) await db.query('insert into auth.users (id, email) values ($1, $2)', [u.id, u.email]);
  await db.query('begin');
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [admin.id]);
  await db.query('set local role authenticated');
  ws = (await db.query("select public.create_workspace('문의함 E2E 법률', 'legal', array['inbox-e2e.kr'], '김대표') as id")).rows[0].id;
  await db.query('commit');
  await db.query("insert into public.users (id, workspace_id, email, name, role) values ($1, $2, $3, '박직원', 'staff')", [staff.id, ws, staff.email]);
  await db.query("update public.channels set coupon_codes = array['블로그 보고 왔어요', 'BLOG10'] where workspace_id = $1 and code = 'blog'", [ws]);
  key = (await db.query('select tracking_key from public.workspaces where id = $1', [ws])).rows[0].tracking_key;
  for (const r of (await db.query('select code, id, name from public.channels where workspace_id = $1', [ws])).rows) channels[r.code ?? r.name] = r.id;

  app = await startApp(PORT, { ADTRACK_TEST_AUTH_SECRET: SECRET });
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  app?.stop();
  await db.end();
});

test('완료 기준: 휴대폰에서 ‘수임 + 금액’까지 탭 2번 (업종 평균 금액 그대로)', async () => {
  const id = await webLead('김민수', '010-2222-0001', { code: 'naver_sa', keyword: '이혼전문변호사', evidence: 'n_keyword=이혼전문변호사' });
  const { context, page } = await phoneAs(staff);
  await page.goto(`${app.url}/app/inquiries`);
  const card = page.locator(`[data-lead-id="${id}"]`);
  await card.waitFor();
  // 카드에 출처·키워드·판별 근거가 보이고 연락처는 가려져 있다
  await assert.doesNotReject(card.getByText('네이버 검색광고').waitFor());
  assert.match(await card.textContent(), /이혼전문변호사/);
  assert.match(await card.textContent(), /010-\*\*\*\*-0001/);
  assert.equal(await card.getByText('010-2222-0001 전화 걸기').isVisible(), false);

  const t = tapper(page);
  await t.tap(card.getByRole('button', { name: '수임', exact: true }));
  const amount = card.getByLabel('수임 금액');
  assert.equal(await amount.inputValue(), '3,000,000', '업종 평균 금액이 미리 채워짐');
  await t.tap(card.getByRole('button', { name: '저장' }));
  await card.locator('.status', { hasText: '수임' }).waitFor();
  await card.getByText('수임 3,000,000원').waitFor();
  assert.ok(t.count <= 3, `탭 ${t.count}번`);
  assert.equal(t.count, 2);

  const l = await waitFor(async () => { const r = await lead(id); return r.status === 'contracted' && r; }, '저장');
  assert.equal(Number(l.contract_amount), 3000000);
  // 새로고침해도 그대로
  await page.reload();
  await page.locator(`[data-lead-id="${id}"] .status`, { hasText: '수임' }).waitFor();
  await context.close();
});

test('금액을 고쳐서 계약, 실패는 사유 탭 한 번으로', async () => {
  const a = await webLead('이서연', '010-2222-0002', { code: 'google_ads', evidence: 'gclid=x' });
  const b = await webLead('최지훈', '010-2222-0003', { code: 'meta_ads', evidence: 'fbclid=x' });
  const { context, page } = await phoneAs(staff);
  await page.goto(`${app.url}/app/inquiries`);

  const cardA = page.locator(`[data-lead-id="${a}"]`);
  const t = tapper(page);
  await t.tap(cardA.getByRole('button', { name: '수임', exact: true }));
  await cardA.getByLabel('수임 금액').fill('2,500,000');
  await t.tap(cardA.getByRole('button', { name: '저장' }));
  await cardA.getByText('수임 2,500,000원').waitFor();
  assert.equal(t.count, 2);
  assert.equal(Number((await lead(a)).contract_amount), 2500000);

  const cardB = page.locator(`[data-lead-id="${b}"]`);
  await cardB.getByRole('button', { name: '실패' }).tap();
  await cardB.getByRole('button', { name: '연락 안 됨' }).tap();
  await cardB.getByText('실패 사유: 연락 안 됨').waitFor();
  const lb = await lead(b);
  assert.deepEqual([lb.status, lb.fail_reason], ['failed', '연락 안 됨']);

  // 잘못된 금액은 저장하지 않는다
  const c = await webLead('정하늘', '010-2222-0009', { code: 'direct' });
  await page.reload();
  const cardC = page.locator(`[data-lead-id="${c}"]`);
  await cardC.getByRole('button', { name: '수임', exact: true }).tap();
  await cardC.getByLabel('수임 금액').fill('삼백만');
  await cardC.getByRole('button', { name: '저장' }).tap();
  await cardC.getByRole('alert').waitFor();
  assert.equal((await lead(c)).status, 'new');
  await context.close();
});

test('400px 화면에서 가로 스크롤이 생기지 않는다', async () => {
  const { context, page } = await phoneAs(staff);
  const anyLead = (await db.query('select id from public.leads where workspace_id = $1 limit 1', [ws])).rows[0].id;
  for (const path of ['/app/inquiries', '/app/inquiries/new', `/app/inquiries/${anyLead}`]) {
    await page.goto(`${app.url}${path}`);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(width <= 400, `${path}: ${width}px`);
    // E2E_SCREENSHOTS=<폴더> 를 주면 화면을 저장한다
    if (process.env.E2E_SCREENSHOTS) {
      await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${path.split('/').pop()}.png`, fullPage: true });
    }
  }
  await context.close();
});

test('직접 등록: 쿠폰 문구를 넣으면 채널이 자동으로 골라진다', async () => {
  const { context, page } = await phoneAs(staff);
  await page.goto(`${app.url}/app/inquiries/new`);
  await page.getByLabel('이름').fill('한소희');
  await page.getByLabel('연락처').fill('01022220004');
  await page.getByLabel('상담 유형').selectOption('형사');
  await page.getByLabel(/쿠폰·암호 문구/).fill('blog10');
  await page.getByText('쿠폰 문구로 ‘블로그·체험단’ 이(가) 선택됐어요').waitFor();
  await Promise.all([page.waitForURL('**/app/inquiries?notice=*'), page.getByRole('button', { name: '등록' }).tap()]);
  await page.getByText('문의를 등록했어요').waitFor();

  const r = (await db.query("select * from public.leads where workspace_id = $1 and phone_hash = $2", [ws, phoneHash('01022220004')])).rows[0];
  assert.deepEqual([r.method, r.attribution, r.channel_id, r.coupon_code, r.inquiry_type, r.phone_masked],
    ['call', 'coupon', channels.blog, 'blog10', '형사', '010-****-0004']);
  const card = page.locator(`[data-lead-id="${r.id}"]`);
  assert.match(await card.textContent(), /한소희/);
  assert.match(await card.textContent(), /쿠폰 문구/);
  await context.close();
});

test('직접 등록: 유입경로를 안 고르면 등록되지 않고, 고객 응답으로 저장된다', async () => {
  const { context, page } = await phoneAs(staff);
  await page.goto(`${app.url}/app/inquiries/new`);
  await page.getByLabel('이름').fill('오지명');
  await page.getByLabel('방문').check();
  await page.getByRole('button', { name: '등록' }).tap();
  // 브라우저가 필수 칸으로 막는다
  assert.equal(await page.evaluate(() => document.querySelector('#channel_id').validity.valueMissing), true);
  assert.ok(page.url().endsWith('/app/inquiries/new'));

  await page.getByLabel('어떻게 알고 오셨어요?').selectOption({ label: '지인 소개' });
  await Promise.all([page.waitForURL('**/app/inquiries?notice=*'), page.getByRole('button', { name: '등록' }).tap()]);
  const r = (await db.query("select * from public.leads where workspace_id = $1 and name_hash = $2", [ws, nameHash('오지명')])).rows[0];
  assert.deepEqual([r.method, r.attribution, r.channel_id, r.asked_channel_id], ['walkin', 'asked', channels.referral, channels.referral]);
  await context.close();
});

test('이미 있는 연락처로 직접 등록하면 다시 연락으로 기록하고 그 문의로 간다', async () => {
  const id = await webLead('윤아름', '010-2222-0005', { code: 'naver_sa', evidence: 'n_media=1' });
  const { context, page } = await phoneAs(staff);
  await page.goto(`${app.url}/app/inquiries/new`);
  await page.getByLabel('연락처').fill('010 2222 0005');
  await page.getByLabel('어떻게 알고 오셨어요?').selectOption({ label: '자연 검색' });
  await Promise.all([page.waitForURL(`**/app/inquiries/${id}?notice=*`), page.getByRole('button', { name: '등록' }).tap()]);
  await page.getByText('이미 있는 연락처라 새 문의 대신 다시 연락으로 기록했어요').waitFor();
  await page.getByText('다시 연락 (1)').waitFor();
  assert.equal((await lead(id)).channel_id, channels.naver_sa, '출처는 첫 문의 것');
  await context.close();
});

test('상세: 출처를 바꾸면 직접 선택으로 표시되고 변경 기록에 누가 바꿨는지 남는다', async () => {
  const id = await webLead('장도윤', '010-2222-0006', { code: 'naver_sa', keyword: '형사변호사', evidence: 'n_keyword=형사변호사' });
  const { context, page } = await phoneAs(staff);
  await page.goto(`${app.url}/app/inquiries/${id}`);
  await page.getByText('n_keyword=형사변호사').waitFor();
  await page.getByLabel(/출처 바꾸기/).selectOption({ label: '지인 소개' });
  await Promise.all([page.waitForURL(`**/app/inquiries/${id}?notice=*`), page.locator('form', { has: page.getByLabel(/출처 바꾸기/) }).getByRole('button', { name: '저장' }).tap()]);
  await page.getByText('출처를 바꿨어요 (직접 선택)').waitFor();
  const events = await page.getByTestId('events').textContent();
  assert.match(events, /출처: 네이버 검색광고 → 지인 소개/);
  assert.match(events, /판별 방식: 자동 → 직접 선택/);
  assert.match(events, /박직원/);
  // 원래 자동 판별 근거는 그대로 보인다
  await page.getByText('n_keyword=형사변호사').waitFor();

  // 고객 응답만 추가하면 출처는 그대로
  await page.getByLabel(/고객 응답 /).selectOption({ label: '블로그·체험단' });
  await page.locator('form', { has: page.getByLabel(/고객 응답 /) }).getByRole('button', { name: '저장' }).tap();
  await page.getByText('고객 응답을 저장했어요').waitFor();
  const l = await lead(id);
  assert.deepEqual([l.channel_id, l.asked_channel_id, l.attribution], [channels.referral, channels.blog, 'manual']);
  await context.close();
});

test('상세: 완료 페이지로 들어온 문의에 이름·연락처를 채운다', async () => {
  const r = await db.query('select public.collect_lead($1, $2, $3, $4, $5) as r', [key, 'inbox-e2e.kr', randomUUID(), randomUUID(), { source: { code: 'direct', evidence: '꼬리표·유입 주소 없음' } }]);
  const id = r.rows[0].r.lead_id;
  const { context, page } = await phoneAs(staff);
  await page.goto(`${app.url}/app/inquiries/${id}`);
  await page.locator('#name').fill('문채원');
  await page.locator('#phone').fill('010-2222-0007');
  await Promise.all([page.waitForURL(`**/app/inquiries/${id}?notice=*`), page.locator('form', { has: page.locator('#name') }).getByRole('button', { name: '저장' }).tap()]);
  await page.getByText('고객 정보를 저장했어요').waitFor();
  const l = await lead(id);
  assert.equal(l.phone_masked, '010-****-0007');
  assert.equal(l.name_hash, nameHash('문채원'));
  assert.ok(!JSON.stringify(l).includes('문채원'), '이름은 암호화되어 저장');
  await context.close();
});

test('검색과 필터: 이름, 뒷자리, 전체 번호, 상태, 채널', async () => {
  const { context, page } = await phoneAs(staff);
  const cards = () => page.getByTestId('lead-card');
  const search = async (q) => {
    await page.goto(`${app.url}/app/inquiries?q=${encodeURIComponent(q)}`);
    return cards().count();
  };
  assert.equal(await search('김민수'), 1);
  assert.equal(await search('김 민수'), 1);
  assert.equal(await search('0001'), 1);
  assert.equal(await search('010-2222-0001'), 1);
  assert.equal(await search('없는사람'), 0);
  await page.getByText('찾는 문의가 없어요').waitFor();

  await page.goto(`${app.url}/app/inquiries`);
  await page.getByRole('link', { name: '수임' }).tap();
  await page.waitForURL('**status=contracted');
  const statuses = await page.locator('[data-testid=lead-card] .status').allTextContents();
  assert.ok(statuses.length >= 2 && statuses.every((s) => s === '수임'), statuses.join());

  await page.goto(`${app.url}/app/inquiries`);
  await page.getByLabel('채널').selectOption({ label: '구글 광고' });
  await page.getByRole('button', { name: '적용' }).tap();
  await page.waitForURL(`**channel=${channels.google_ads}*`);
  const sources = await page.locator('[data-testid=lead-card] .lead-source').allTextContents();
  assert.ok(sources.length >= 1 && sources.every((s) => s.startsWith('구글 광고')), sources.join());
  await context.close();
});

test('문의함 탭에 새 문의 수가 보인다', async () => {
  const { context, page } = await phoneAs(staff);
  await page.goto(`${app.url}/app/inquiries`);
  const n = (await db.query("select count(*)::int as n from public.leads where workspace_id = $1 and status = 'new'", [ws])).rows[0].n;
  assert.equal(await page.locator('.tab-badge').textContent(), String(n));
  await context.close();
});

test('직원은 문의함만 보고, 지우기는 관리자만', async () => {
  const id = await webLead('삭제할사람', '010-2222-0008', { code: 'direct' });
  const { context, page } = await phoneAs(staff);
  await page.goto(`${app.url}/app/inquiries`);
  assert.deepEqual(await page.locator('nav.tabs a').allTextContents().then((t) => t.map((x) => x.replace(/\d+$/, ''))), ['문의함']);
  await page.goto(`${app.url}/app/setup`);
  await page.waitForURL('**/app/inquiries');
  await page.goto(`${app.url}/app/inquiries/${id}`);
  assert.equal(await page.getByRole('button', { name: '이 문의 지우기' }).count(), 0);
  await context.close();

  const adminPhone = await phoneAs(admin);
  await adminPhone.page.goto(`${app.url}/app/inquiries/${id}`);
  await Promise.all([adminPhone.page.waitForURL('**/app/inquiries?notice=*'), adminPhone.page.getByRole('button', { name: '이 문의 지우기' }).tap()]);
  assert.equal(await lead(id), undefined);
  await adminPhone.context.close();
});

test('서명이 틀린 테스트 쿠키로는 들어갈 수 없다', async () => {
  const context = await browser.newContext();
  await context.addCookies([{ name: 'adtrack_test_user', value: `${admin.id}.forged`, url: app.url }]);
  const page = await context.newPage();
  await page.goto(`${app.url}/app/inquiries`);
  await page.waitForURL('**/login');
  await context.close();
});
