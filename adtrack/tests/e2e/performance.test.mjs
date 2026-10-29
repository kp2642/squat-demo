// 5단계 완료 기준: 예시 데이터로 손으로 계산한 값과 화면 숫자가 모두 일치.
// 예시(법률·병원·인테리어)와 손 계산은 tests/fixtures/performance-example.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { chromium } from 'playwright';
import { TEST_AUTH_SECRET, loggedIn, startApp } from './app.mjs';
import { EXAMPLES, seedExample, seedPerformanceExample } from '../fixtures/performance-example.mjs';

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

for (const [name, example] of Object.entries(EXAMPLES)) {
  test(`${name} 예시: 화면 숫자가 손 계산과 모두 같다`, async () => {
    // 업종마다 새 사업장
    const owner = { id: randomUUID(), email: `perf-e2e-${name}-${Date.now()}@example.com` };
    await db.query('insert into auth.users (id, email) values ($1, $2)', [owner.id, owner.email]);
    await db.query('begin');
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [owner.id]);
    await db.query('set local role authenticated');
    const id = (await db.query("select public.create_workspace($1, $2, array[]::text[], '대표') as id", [`${name} 예시`, example.industry])).rows[0].id;
    await db.query('commit');
    await seedExample(db, id, example);

    const { context, page } = await loggedIn(browser, app, owner, { viewport: { width: 1280, height: 900 } });
    await page.goto(`${app.url}${SEPTEMBER}`);
    const e = example.expected;
    assert.equal(await text(page.getByTestId('period')), '2026. 9. 1. ~ 2026. 9. 30. 에 등록된 문의 기준');
    for (const [key, value] of Object.entries(e.tiles)) assert.equal(await text(page.getByTestId(`sum-${key}`)), value, key);
    assert.deepEqual(await tableRows(page, 'channels'), e.channels);
    if (e.keywords.length) assert.deepEqual(await tableRows(page, 'keywords'), e.keywords);
    else assert.equal(await page.getByTestId('keywords').count(), 0, '키워드 광고비가 없으면 키워드 표 없음');
    assert.equal(await text(page.getByTestId('suggestion')), e.suggestion);
    const basis = await text(page.getByTestId('suggestion-basis'));
    assert.ok(basis.includes(`비교한 채널: ${e.basis.compared.join(', ')}.`), basis);
    if (e.basis.tooFew.length) assert.ok(basis.includes(`문의가 적어 뺀 채널: ${e.basis.tooFew.map((c) => `${c.name}(${c.leads}건)`).join(', ')}.`), basis);
    else assert.ok(!basis.includes('뺀 채널'), basis);
    const attr = await text(page.getByTestId('attribution'));
    for (const line of e.attribution) assert.ok(attr.includes(line), `${line} in ${attr}`);
    if (e.stale) assert.match(await text(page.getByTestId('stale')), new RegExp(`${example.term}·실패 결과가 아직 입력되지 않은 7일 지난 문의가 ${e.stale}건`));
    else assert.equal(await page.getByTestId('stale').count(), 0, '미입력 문의가 없으면 경고 없음');
    // 표 머리글도 업종 용어
    const headers = await page.locator('[data-testid=channels] thead th').allTextContents();
    assert.deepEqual(headers.slice(3, 7), [example.term, '전환율', '문의당 비용', `${example.term}당 비용`]);
    await context.close();
  });
}

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
