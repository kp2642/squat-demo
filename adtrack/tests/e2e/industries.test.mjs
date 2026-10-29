// 업종 6종 모두: 업종을 고르면 계약 용어·평균 금액·상담 유형이 화면 곳곳에 맞게 나오는지.
// (가입 화면 → 사업장 만들기는 create_workspace 로, 그 뒤 화면은 브라우저로 본다)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { chromium } from 'playwright';
import { TEST_AUTH_SECRET, loggedIn, startApp } from './app.mjs';

const PORT = 3250;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
let app;
let browser;
let presets;

before(async () => {
  await db.connect();
  presets = (await db.query('select * from public.industry_presets order by position')).rows;
  app = await startApp(PORT, { ADTRACK_TEST_AUTH_SECRET: TEST_AUTH_SECRET });
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  app?.stop();
  await db.end();
});

test('업종 프리셋은 6종', () => {
  assert.deepEqual(presets.map((p) => p.name), ['법률', '병원·의원', '세무·회계', '학원·교육', '인테리어', '기타 상담형']);
});

for (const key of ['legal', 'clinic', 'tax', 'academy', 'interior', 'other']) {
  test(`${key}: 계약 용어·평균 금액·상담 유형이 화면에 맞게 나온다`, async () => {
    const preset = presets.find((p) => p.key === key);
    const term = preset.contract_term;
    const avg = Number(preset.avg_contract_amount).toLocaleString('ko-KR');
    const owner = { id: randomUUID(), email: `industry-${key}-${Date.now()}@example.com` };
    await db.query('insert into auth.users (id, email) values ($1, $2)', [owner.id, owner.email]);
    await db.query('begin');
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [owner.id]);
    await db.query('set local role authenticated');
    const ws = (await db.query('select public.create_workspace($1, $2) as id', [`${preset.name} 사업장`, key])).rows[0].id;
    await db.query('commit');
    const lead = (await db.query(
      "insert into public.leads (workspace_id, method, attribution, status, phone_masked) values ($1, 'call', 'unknown', 'new', '010-****-1234') returning id", [ws])).rows[0].id;

    const { context, page } = await loggedIn(browser, app, owner);

    // 문의함: 상태 탭과 카드 버튼이 업종 용어, 누르면 업종 평균 금액이 채워짐
    await page.goto(`${app.url}/app/inquiries`);
    await page.locator('.status-tabs a', { hasText: term }).waitFor();
    const card = page.locator(`[data-lead-id="${lead}"]`);
    await card.getByRole('button', { name: term, exact: true }).tap();
    assert.equal(await card.getByLabel(`${term} 금액`).inputValue(), avg);
    await card.getByRole('button', { name: '저장' }).tap();
    await card.getByText(`${term} ${avg}원`).waitFor();

    // 직접 등록: 상담 유형 목록이 업종 프리셋
    await page.goto(`${app.url}/app/inquiries/new`);
    const options = await page.locator('#inquiry_type option').allTextContents();
    assert.deepEqual(options.slice(1), preset.inquiry_types);

    // 성과: 요약 숫자 이름이 업종 용어
    await page.goto(`${app.url}/app`);
    assert.equal(await page.getByTestId('sum-contracts').locator('.tile-label').textContent(), term);
    assert.equal(await page.getByTestId('sum-revenue').locator('.tile-label').textContent(), `${term} 매출`);
    assert.equal(await page.getByTestId('sum-cpa').locator('.tile-label').textContent(), `${term}당 비용`);
    await context.close();
  });
}
