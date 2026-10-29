// 4단계 광고비 화면: 월·채널 입력, 지난 달 복사, 네이버 키워드 CSV 올리기, 채널 관리, 권한.
// 완료 기준 ‘네이버 광고센터에서 받은 실제 CSV 파일이 오류 없이 들어감’은 실제 파일이 있어야 확인할 수 있어서,
// 여기서는 알려진 형식들을 본뜬 tests/fixtures/naver/*.csv 를 실제 파일 올리기로 넣어 본다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { chromium } from 'playwright';
import { TEST_AUTH_SECRET, loggedIn, startApp } from './app.mjs';

const PORT = 3230;
const MONTH = '2026-09';
const fixture = (name) => fileURLToPath(new URL(`../fixtures/naver/${name}`, import.meta.url));
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const admin = { id: randomUUID(), email: `spend-e2e-admin-${Date.now()}@example.com` };
const staff = { id: randomUUID(), email: `spend-e2e-staff-${Date.now()}@example.com` };
let app;
let browser;
let ws;
const ch = {};

const spend = (code, month = MONTH) => db.query(
  'select s.amount from public.ad_spend s join public.channels c on c.id = s.channel_id where c.workspace_id = $1 and c.code = $2 and s.month = $3',
  [ws, code, `${month}-01`]).then((r) => (r.rows[0] ? Number(r.rows[0].amount) : null));
const keywords = () => db.query('select keyword, amount::int, clicks from public.keyword_spend where workspace_id = $1 and month = $2 order by amount desc', [ws, `${MONTH}-01`]).then((r) => r.rows);

async function upload(page, file, { setChannel = true } = {}) {
  await page.goto(`${app.url}/app/spend?month=${MONTH}`);
  await page.locator('#csv').setInputFiles(fixture(file));
  if (!setChannel) await page.getByLabel(/네이버 검색광고 월 광고비도/).uncheck();
  await page.getByRole('button', { name: '올리기', exact: true }).tap();
  await page.locator('.notice, .error').first().waitFor();
  return page.locator('.notice, .error').first().textContent();
}

before(async () => {
  await db.connect();
  for (const u of [admin, staff]) await db.query('insert into auth.users (id, email) values ($1, $2)', [u.id, u.email]);
  await db.query('begin');
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [admin.id]);
  await db.query('set local role authenticated');
  ws = (await db.query("select public.create_workspace('광고비 E2E', 'legal', array['spend-e2e.kr']) as id")).rows[0].id;
  await db.query('commit');
  await db.query("insert into public.users (id, workspace_id, email, role) values ($1, $2, $3, 'staff')", [staff.id, ws, staff.email]);
  for (const r of (await db.query('select code, id from public.channels where workspace_id = $1 and code is not null', [ws])).rows) ch[r.code] = r.id;
  app = await startApp(PORT, { ADTRACK_TEST_AUTH_SECRET: TEST_AUTH_SECRET });
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  app?.stop();
  await db.end();
});

test('채널별 월 광고비를 입력하고 저장한다 (휴대폰)', async () => {
  const { context, page } = await loggedIn(browser, app, admin);
  await page.goto(`${app.url}/app/spend?month=2026-08`);
  await page.locator('.month-nav strong', { hasText: '2026년 8월' }).waitFor();
  await page.getByLabel('네이버 검색광고 광고비').fill('1,200,000');
  await page.getByLabel('메타 광고 광고비').fill('500000원');
  await page.getByRole('button', { name: '저장', exact: true }).first().tap();
  await page.getByText('광고비를 저장했어요').waitFor();
  assert.equal(await spend('naver_sa', '2026-08'), 1200000);
  assert.equal(await spend('meta_ads', '2026-08'), 500000);
  assert.equal(await page.getByLabel('네이버 검색광고 광고비').inputValue(), '1,200,000');
  await page.getByText('합계 1,700,000원').waitFor();

  // 숫자가 아니면 저장하지 않는다
  await page.getByLabel('구글 광고 광고비').fill('많이');
  await page.getByRole('button', { name: '저장', exact: true }).first().tap();
  await page.getByText('금액을 숫자로 적어 주세요: 많이').waitFor();
  assert.equal(await spend('google_ads', '2026-08'), null);

  // 400px 에서 가로 스크롤 없음
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth) <= 400);
  await context.close();
});

test('다음 달로 넘어가 지난 달 금액을 복사한다', async () => {
  const { context, page } = await loggedIn(browser, app, admin);
  await page.goto(`${app.url}/app/spend?month=2026-08`);
  await Promise.all([page.waitForURL(`**month=${MONTH}`), page.getByRole('link', { name: '다음 달' }).tap()]);
  await page.getByText('지난 달 1,200,000원').waitFor();
  await page.getByRole('button', { name: /지난 달 금액 복사/ }).tap();
  await page.getByText(/2개 채널에 복사했어요/).waitFor();
  assert.equal(await spend('naver_sa'), 1200000);
  assert.equal(await spend('meta_ads'), 500000);
  await context.close();
});

test('키워드 보고서 CSV (UTF-8, 제목 줄, 합계 줄) → 키워드 반영, 네이버 월 광고비도 합계로', async () => {
  const { context, page } = await loggedIn(browser, app, admin);
  const notice = await upload(page, 'multidim-utf8bom.csv');
  assert.match(notice, /키워드 4개, 합계 975,960원을 반영했어요/);
  assert.match(notice, /비용 칸: 총비용\(VAT포함,원\)/);
  assert.match(notice, /합계·빈 키워드 줄 1개 제외/);
  assert.deepEqual(await keywords(), [
    { keyword: '이혼전문변호사', amount: 542340, clicks: 361 },
    { keyword: '형사변호사', amount: 346500, clicks: 150 },
    { keyword: '재산분할, 위자료', amount: 87120, clicks: 88 },
    { keyword: '음주운전변호사', amount: 0, clicks: 0 },
  ]);
  assert.equal(await spend('naver_sa'), 975960);
  await page.getByRole('cell', { name: '이혼전문변호사', exact: true }).waitFor();
  assert.equal(await page.getByLabel('네이버 검색광고 광고비').inputValue(), '975,960');
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/spend.png`, fullPage: true });
  await context.close();
});

test('EUC-KR 파일과 탭 구분 일별 파일도 들어간다, 다시 올리면 바뀐다', async () => {
  const { context, page } = await loggedIn(browser, app, admin);
  assert.match(await upload(page, 'keywords-euckr.csv', { setChannel: false }), /키워드 2개, 합계 253,500원/);
  assert.deepEqual((await keywords()).map((k) => k.keyword), ['강남임플란트', '투명교정']);
  assert.equal(await spend('naver_sa'), 975960, '체크를 끄면 채널 금액은 그대로');

  assert.match(await upload(page, 'daily-tab.csv'), /키워드 2개, 합계 11,100원/);
  assert.deepEqual(await keywords(), [
    { keyword: '투명교정', amount: 9000, clicks: 5 },
    { keyword: '강남임플란트', amount: 2100, clicks: 1 },
  ]);
  await context.close();
});

test('읽을 수 없는 파일·다른 달 파일은 이유를 보여 주고 기존 값을 지우지 않는다', async () => {
  const { context, page } = await loggedIn(browser, app, admin);
  const before = await keywords();
  assert.match(await upload(page, 'no-cost.csv'), /비용 칸\(총비용\)을 찾지 못했어요. 찾은 칸: 키워드, 노출수, 클릭수/);
  assert.match(await upload(page, 'daily-two-months.csv'), /여러 달/);
  await page.goto(`${app.url}/app/spend?month=2026-10`);
  await page.locator('#csv').setInputFiles(fixture('multidim-utf8bom.csv'));
  await page.getByRole('button', { name: '올리기', exact: true }).tap();
  await page.getByText(/고른 달\(2026-10\)과 달라요/).waitFor();
  assert.deepEqual(await keywords(), before);
  await context.close();
});

test('키워드 직접 입력과 지우기', async () => {
  const { context, page } = await loggedIn(browser, app, admin);
  await page.goto(`${app.url}/app/spend?month=${MONTH}`);
  await page.getByText('키워드 직접 입력').tap();
  await page.getByLabel('키워드', { exact: true }).fill('라미네이트');
  await page.getByLabel('키워드 광고비').fill('33,000');
  await page.locator('form', { has: page.getByLabel('키워드 광고비') }).getByRole('button', { name: '저장' }).tap();
  await page.getByText('‘라미네이트’ 광고비를 저장했어요').waitFor();
  assert.ok((await keywords()).some((k) => k.keyword === '라미네이트' && k.amount === 33000));
  await page.getByRole('button', { name: '라미네이트 지우기' }).tap();
  await page.getByText('‘라미네이트’ 을(를) 지웠어요').waitFor();
  await page.getByRole('button', { name: '이 달 키워드 모두 지우기' }).tap();
  await page.getByText(/이 달 키워드 2개를 지웠어요/).waitFor();
  assert.deepEqual(await keywords(), []);
  await context.close();
});

test('채널 추가·숨기기', async () => {
  const { context, page } = await loggedIn(browser, app, admin);
  await page.goto(`${app.url}/app/spend?month=${MONTH}`);
  await page.getByLabel('채널 추가').fill('당근 광고');
  await page.getByLabel('새 채널 utm_source 값').fill('daangn, Karrot');
  await page.getByRole('button', { name: '추가', exact: true }).tap();
  await page.locator('.notice, .error').first().waitFor();
  assert.equal(await page.locator('.notice, .error').first().textContent(), '‘당근 광고’ 채널을 추가했어요');
  const c = (await db.query("select * from public.channels where workspace_id = $1 and name = '당근 광고'", [ws])).rows[0];
  assert.deepEqual([c.kind, c.utm_sources], ['paid', ['daangn', 'karrot']]);
  // 새 채널도 광고비 표에 나온다
  await page.getByLabel('당근 광고 광고비').waitFor();

  await page.locator('.channel-edit summary', { hasText: '카카오 광고' }).tap();
  const form = page.locator('.channel-edit', { hasText: '카카오 광고' }).locator('form');
  await form.getByLabel(/숨기기/).check();
  await form.getByRole('button', { name: '저장' }).tap();
  await page.getByText('‘카카오 광고’ 채널을 저장했어요').waitFor();
  assert.equal((await db.query('select hidden from public.channels where id = $1', [ch.kakao_ads])).rows[0].hidden, true);
  assert.equal(await page.getByLabel('카카오 광고 광고비').count(), 0, '숨긴 채널은 광고비 표에서 빠짐');
  await context.close();
});

test('직원은 광고비 화면에 들어갈 수 없다', async () => {
  const { context, page } = await loggedIn(browser, app, staff);
  await page.goto(`${app.url}/app/spend`);
  await page.waitForURL('**/app/inquiries');
  await context.close();
});
