// 5단계 완료 기준: 예시 데이터로 손으로 계산한 값과 화면 숫자가 모두 일치.
// 손 계산은 tests/unit/performance.test.ts 맨 위 주석, 예시 데이터는 tests/fixtures/performance-example.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { chromium } from 'playwright';
import { TEST_AUTH_SECRET, loggedIn, startApp } from './app.mjs';
import { seedPerformanceExample } from '../fixtures/performance-example.mjs';

const PORT = 3240;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const admin = { id: randomUUID(), email: `perf-e2e-admin-${Date.now()}@example.com` };
const staff = { id: randomUUID(), email: `perf-e2e-staff-${Date.now()}@example.com` };
let app;
let browser;
const SEPTEMBER = '/app?period=custom&from=2026-09-01&to=2026-09-30';

const text = (locator) => locator.innerText().then((s) => s.replace(/\s+/g, ' ').trim());

async function tableRows(page, testid) {
  return page.locator(`[data-testid=${testid}] tbody tr`).evaluateAll((trs) =>
    trs.map((tr) => [...tr.children].map((c) => c.textContent.replace(/\s+/g, ' ').trim())));
}

before(async () => {
  await db.connect();
  for (const u of [admin, staff]) await db.query('insert into auth.users (id, email) values ($1, $2)', [u.id, u.email]);
  await db.query('begin');
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [admin.id]);
  await db.query('set local role authenticated');
  const ws = (await db.query("select public.create_workspace('성과 E2E 법률', 'legal', array[]::text[], '김대표') as id")).rows[0].id;
  await db.query('commit');
  await db.query("insert into public.users (id, workspace_id, email, role) values ($1, $2, $3, 'staff')", [staff.id, ws, staff.email]);
  await seedPerformanceExample(db, ws);
  app = await startApp(PORT, { ADTRACK_TEST_AUTH_SECRET: TEST_AUTH_SECRET });
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  app?.stop();
  await db.end();
});

test('요약 숫자가 손 계산과 같다', async () => {
  const { context, page } = await loggedIn(browser, app, admin, { viewport: { width: 1280, height: 900 } });
  await page.goto(`${app.url}${SEPTEMBER}`);
  assert.equal(await text(page.getByTestId('period')), '2026. 9. 1. ~ 2026. 9. 30. 에 등록된 문의 기준');
  assert.equal(await text(page.getByTestId('sum-spend')), '광고비 1,800,000원');
  assert.equal(await text(page.getByTestId('sum-leads')), '문의 27건 전환율 25.9%');
  assert.equal(await text(page.getByTestId('sum-contracts')), '수임 7건');
  assert.equal(await text(page.getByTestId('sum-revenue')), '수임 매출 10,400,000원');
  assert.equal(await text(page.getByTestId('sum-roas')), 'ROAS 578% 광고비 1원당 5.8원');
  assert.equal(await text(page.getByTestId('sum-cpl')), '문의당 비용 66,667원');
  assert.equal(await text(page.getByTestId('sum-cpa')), '수임당 비용 257,143원');
  await context.close();
});

test('채널별 표·키워드 표·제안·판별 비율·미입력 경고가 손 계산과 같다', async () => {
  const { context, page } = await loggedIn(browser, app, admin, { viewport: { width: 1280, height: 900 } });
  await page.goto(`${app.url}${SEPTEMBER}`);
  assert.deepEqual(await tableRows(page, 'channels'), [
    ['네이버 검색광고', '1,000,000원', '10', '3', '30.0%', '100,000원', '333,333원', '6,000,000원', '600%', '확대 검토'],
    ['구글 광고', '500,000원', '6', '1', '16.7%', '83,333원', '500,000원', '1,500,000원', '300%', '유지'],
    ['메타 광고', '300,000원', '4', '1', '25.0%', '75,000원', '300,000원', '400,000원', '133%', '표본 부족'],
    ['블로그·체험단', '0원', '3', '1', '33.3%', '-', '-', '2,000,000원', '-', '무료 유입'],
    ['지인 소개', '0원', '2', '0', '0.0%', '-', '-', '0원', '-', '무료 유입'],
    ['출처 미확인', '0원', '2', '1', '50.0%', '-', '-', '500,000원', '-', '무료 유입'],
  ]);
  assert.deepEqual(await tableRows(page, 'keywords'), [
    ['이혼전문변호사', '600,000원', '6', '2', '33.3%', '100,000원', '300,000원', '5,000,000원', '833%', '확대 검토'],
    ['형사변호사', '400,000원', '3', '1', '33.3%', '133,333원', '400,000원', '1,000,000원', '250%', '표본 부족'],
  ]);
  assert.equal(await text(page.getByTestId('suggestion')),
    '네이버 검색광고 ROAS 600%로 가장 높고, 구글 광고는 300%로 가장 낮아요. 구글 광고 예산 일부를 네이버 검색광고로 옮기는 걸 검토해 보세요.');
  assert.equal(await text(page.getByTestId('suggestion-basis')),
    '제안은 광고비를 쓴 유료 채널 중 문의 5건 이상인 채널끼리만 비교해요. 문의가 적으면 계약 1건으로 ROAS 가 크게 흔들리기 때문이에요. '
    + '비교한 채널: 네이버 검색광고, 구글 광고. 문의가 적어 뺀 채널: 메타 광고(4건).');
  const attr = await text(page.getByTestId('attribution'));
  for (const s of ['자동 (추적 코드) 20건 · 74%', '쿠폰 문구 1건 · 4%', '고객 응답 2건 · 7%', '직원 직접 선택 2건 · 7%', '출처 미확인 2건 · 7%']) {
    assert.ok(attr.includes(s), `${s} in ${attr}`);
  }
  assert.match(await text(page.getByTestId('stale')), /7일 지난 문의가 15건/);
  await context.close();
});

test('월 일부 기간은 광고비를 일수로 나눠 보여 준다', async () => {
  const { context, page } = await loggedIn(browser, app, admin);
  await page.goto(`${app.url}/app`);
  await page.getByLabel('시작일').fill('2026-09-16');
  await page.getByLabel('종료일').fill('2026-10-15');
  await Promise.all([page.waitForURL('**period=custom*'), page.getByRole('button', { name: '보기' }).tap()]);
  assert.match(await text(page.getByTestId('period')), /2026\. 9\. 16\. ~ 2026\. 10\. 15\..*일수만큼 나눠 계산/);
  const rows = await tableRows(page, 'channels');
  // 네이버: 1,000,000 × 15/30 + 620,000 × 15/31 = 800,000
  assert.equal(rows.find((r) => r[0] === '네이버 검색광고')[1], '800,000원');
  assert.equal(rows.find((r) => r[0] === '구글 광고')[1], '250,000원');
  // 400px 휴대폰: 가로 스크롤 없이 채널 카드에 ROAS·판단이 보인다
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth) <= 400);
  const naverCard = page.locator('[data-testid=channels-cards] li[data-row="네이버 검색광고"]');
  assert.ok(await naverCard.isVisible());
  assert.match(await text(naverCard), /광고비\s+800,000원/);
  if (process.env.E2E_SCREENSHOTS) {
    await page.goto(`${app.url}${SEPTEMBER}`);
    const sep = page.locator('[data-testid=channels-cards] li[data-row="네이버 검색광고"]');
    assert.match(await text(sep), /확대 검토/);
    assert.match(await text(sep), /ROAS 600%/);
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/performance.png`, fullPage: true });
  }
  await context.close();
});

test('직원은 성과 화면을 볼 수 없다', async () => {
  const { context, page } = await loggedIn(browser, app, staff);
  await page.goto(`${app.url}/app`);
  await page.waitForURL('**/app/inquiries');
  await context.close();
});
