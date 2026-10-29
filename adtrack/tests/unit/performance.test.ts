// 성과 계산을 손으로 계산한 값과 맞춰 본다. 예시 데이터와 손 계산은 tests/fixtures/performance-example.mjs (법률·병원·인테리어).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePerformance, josa, metrics, percent, won } from '../../src/lib/performance.ts';
// @ts-expect-error 테스트 데이터는 타입 없는 .mjs
import { EXAMPLES, rawFromExample } from '../fixtures/performance-example.mjs';

const tableOf = (rows: ReturnType<typeof computePerformance>['channels']) =>
  rows.map((r) => [r.name, won(r.spend), String(r.leads), String(r.contracts), percent(r.conversion, 1), won(r.cpl), won(r.cpa), won(r.revenue), percent(r.roas), r.badge]);

for (const [name, example] of Object.entries(EXAMPLES) as [string, any][]) {
  test(`${name}: 요약·채널 표·키워드 표·제안·판별 비율이 손 계산과 같다`, () => {
    const p = computePerformance(rawFromExample(example));
    const t = p.total;
    const e = example.expected.tiles;
    const term = example.term;
    assert.equal(`광고비 ${won(t.spend)}`, e.spend);
    assert.equal(`문의 ${t.leads}건 전환율 ${percent(t.conversion, 1)}`, e.leads);
    assert.equal(`${term} ${t.contracts}건`, e.contracts);
    assert.equal(`${term} 매출 ${won(t.revenue)}`, e.revenue);
    assert.equal(`ROAS ${percent(t.roas)} 광고비 1원당 ${(t.roas! / 100).toFixed(1)}원`, e.roas);
    assert.equal(`문의당 비용 ${won(t.cpl)}`, e.cpl);
    assert.equal(`${term}당 비용 ${won(t.cpa)}`, e.cpa);
    assert.deepEqual(tableOf(p.channels), example.expected.channels);
    assert.deepEqual(tableOf(p.keywords), example.expected.keywords);
    assert.equal(p.suggestion, example.expected.suggestion);
    assert.deepEqual(p.suggestionBasis, example.expected.basis);
    const a = p.attribution;
    const pct = (n: number) => percent((n / t.leads) * 100);
    assert.deepEqual([
      `자동 (추적 코드) ${a.auto}건 · ${pct(a.auto)}`, `쿠폰 문구 ${a.coupon}건 · ${pct(a.coupon)}`, `고객 응답 ${a.asked}건 · ${pct(a.asked)}`,
      `직원 직접 선택 ${a.manual}건 · ${pct(a.manual)}`, `출처 미확인 ${a.unknown}건 · ${pct(a.unknown)}`,
    ], example.expected.attribution);
    assert.equal(p.stale, example.expected.stale);
  });
}

test('키워드 광고비를 안 넣었으면 키워드 표 없음', () => {
  const raw = rawFromExample(EXAMPLES.legal);
  assert.equal(computePerformance({ ...raw, has_keyword_spend: false }).keywords.length, 0);
});

test('판단 딱지 경계값', () => {
  const s = { roas_high: 500, roas_low: 200 };
  const b = (spend: number, leads: number, revenue: number) => metrics({ spend, leads, contracts: 1, revenue }, s).badge;
  assert.equal(b(100, 5, 500), '확대 검토', '정확히 500%');
  assert.equal(b(100, 5, 499), '유지');
  assert.equal(b(100, 5, 200), '유지', '정확히 200%');
  assert.equal(b(100, 5, 199), '점검 필요');
  assert.equal(b(100, 4, 10_000), '표본 부족');
  assert.equal(b(0, 100, 10_000), '무료 유입');
  const zero = metrics({ spend: 100, leads: 0, contracts: 0, revenue: 0 }, s);
  assert.deepEqual([zero.cpl, zero.cpa, zero.conversion, zero.roas], [null, null, 0, 0]);
});

test('제안: 비교할 채널이 하나뿐이면 없고, 판단 기준을 바꾸면 문구도 바뀐다', () => {
  const raw = rawFromExample(EXAMPLES.legal);
  const only = computePerformance({ ...raw, channels: raw.channels.filter((c: { id: string }) => c.id !== 'google_ads') });
  assert.equal(only.suggestion, null);
  assert.deepEqual(only.suggestionBasis, { compared: ['네이버 검색광고'], tooFew: [{ name: '메타 광고', leads: 4 }] });
  // 기준을 250% 로 낮추면 네이버(600%)·구글(300%) 모두 기준 이상
  const low = computePerformance(rawFromExample(EXAMPLES.legal, { roas_high: 250, roas_low: 100 }));
  assert.equal(low.suggestion, '비교한 채널이 모두 ROAS 250% 이상이에요. 가장 높은 네이버 검색광고(600%)부터 예산을 늘리는 걸 검토해 보세요.');
});

test('조사', () => {
  assert.equal(josa('구글 광고', '은', '는'), '구글 광고는');
  assert.equal(josa('당근마켓', '은', '는'), '당근마켓은');
  assert.equal(josa('네이버 검색광고', '으로', '로'), '네이버 검색광고로');
  assert.equal(josa('당근마켓', '으로', '로'), '당근마켓으로');
  assert.equal(josa('네이버 블로그', '으로', '로'), '네이버 블로그로');
  assert.equal(josa('지역 카페 글', '으로', '로'), '지역 카페 글로', 'ㄹ 받침은 로');
  assert.equal(josa('Google', '은', '는'), 'Google는');
});
