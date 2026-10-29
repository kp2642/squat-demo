// 성과 계산을 손으로 계산한 값과 맞춰 본다. 예시 데이터는 tests/e2e/performance.test.mjs 와 같다.
//
// 법률 사무소, 판단 기준 500% / 200%, 기간 2026-09-01 ~ 2026-09-30 (한 달 전체라 광고비를 나누지 않음)
//
// 채널           광고비      문의 계약  매출
// 네이버 검색광고  1,000,000   10   3   6,000,000 (3,000,000 + 2,000,000 + 1,000,000)
// 구글 광고        500,000     6   1   1,500,000
// 메타 광고        300,000     4   1     400,000
// 블로그·체험단          0     3   1   2,000,000
// 지인 소개              0     2   0           0
// 카카오 광고            0     0   0           0  ← 문의·광고비 둘 다 없어 표에서 빠짐
// 출처 미확인            -     2   1     500,000
// 합계           1,800,000    27   7  10,400,000
//
// 합계: ROAS 10,400,000 ÷ 1,800,000 × 100 = 577.8% → 578%, 1원당 5.8원
//       문의당 1,800,000 ÷ 27 = 66,666.7 → 66,667원, 계약당 1,800,000 ÷ 7 = 257,142.9 → 257,143원
//       전환율 7 ÷ 27 = 25.9%
// 네이버: 문의당 100,000원, 계약당 333,333원, 전환율 30.0%, ROAS 600% → 확대 검토
// 구글:   문의당 83,333원, 계약당 500,000원, 전환율 16.7%, ROAS 300% → 유지
// 메타:   문의당 75,000원, 계약당 300,000원, 전환율 25.0%, ROAS 133% → 문의 4건이라 표본 부족
// 블로그: 문의당·계약당 '-', 전환율 33.3%, ROAS '-' → 무료 유입
// 지인:   전환율 0.0% → 무료 유입
// 출처 미확인: 전환율 50.0% → 무료 유입 (광고비 없음)
// 제안: 표본 충분한 유료 채널은 네이버(600%)·구글(300%) → 구글 예산 일부를 네이버로
// 판별: 자동 20 (네이버 10 + 구글 6 + 메타 4), 쿠폰 1, 고객 응답 2, 직접 선택 2, 출처 미확인 2 → 자동 74.1%
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePerformance, josa, metrics, percent, won, type RawPerformance } from '../../src/lib/performance.ts';

const ch = (id: string, name: string, kind: 'paid' | 'free', spend: number, leads: number, contracts: number, revenue: number) =>
  ({ id, name, kind, code: id, hidden: false, spend, leads, contracts, revenue });

export const EXAMPLE: RawPerformance = {
  from: '2026-09-01',
  to: '2026-09-30',
  settings: { roas_high: 500, roas_low: 200, contract_term: '수임' },
  channels: [
    ch('naver_sa', '네이버 검색광고', 'paid', 1_000_000, 10, 3, 6_000_000),
    ch('google_ads', '구글 광고', 'paid', 500_000, 6, 1, 1_500_000),
    ch('meta_ads', '메타 광고', 'paid', 300_000, 4, 1, 400_000),
    ch('kakao_ads', '카카오 광고', 'paid', 0, 0, 0, 0),
    ch('blog', '블로그·체험단', 'free', 0, 3, 1, 2_000_000),
    ch('referral', '지인 소개', 'free', 0, 2, 0, 0),
  ],
  unknown: { leads: 2, contracts: 1, revenue: 500_000 },
  keywords: [
    { keyword: '이혼전문변호사', spend: 600_000, leads: 6, contracts: 2, revenue: 5_000_000 },
    { keyword: '형사변호사', spend: 400_000, leads: 3, contracts: 1, revenue: 1_000_000 },
  ],
  has_keyword_spend: true,
  attribution: { auto: 20, coupon: 1, asked: 2, manual: 2, unknown: 2 },
  stale: 15,
};

test('합계: 손으로 계산한 값과 같다', () => {
  const p = computePerformance(EXAMPLE);
  assert.deepEqual([p.total.spend, p.total.leads, p.total.contracts, p.total.revenue], [1_800_000, 27, 7, 10_400_000]);
  assert.equal(percent(p.total.roas), '578%');
  assert.equal((p.total.roas! / 100).toFixed(1), '5.8');
  assert.equal(won(p.total.cpl), '66,667원');
  assert.equal(won(p.total.cpa), '257,143원');
  assert.equal(percent(p.total.conversion, 1), '25.9%');
});

test('채널별 표: 손으로 계산한 값과 같다', () => {
  const p = computePerformance(EXAMPLE);
  const table = p.channels.map((r) => [r.name, won(r.spend), r.leads, r.contracts, percent(r.conversion, 1), won(r.cpl), won(r.cpa), won(r.revenue), percent(r.roas), r.badge]);
  assert.deepEqual(table, [
    ['네이버 검색광고', '1,000,000원', 10, 3, '30.0%', '100,000원', '333,333원', '6,000,000원', '600%', '확대 검토'],
    ['구글 광고', '500,000원', 6, 1, '16.7%', '83,333원', '500,000원', '1,500,000원', '300%', '유지'],
    ['메타 광고', '300,000원', 4, 1, '25.0%', '75,000원', '300,000원', '400,000원', '133%', '표본 부족'],
    ['블로그·체험단', '0원', 3, 1, '33.3%', '-', '-', '2,000,000원', '-', '무료 유입'],
    ['지인 소개', '0원', 2, 0, '0.0%', '-', '-', '0원', '-', '무료 유입'],
    ['출처 미확인', '0원', 2, 1, '50.0%', '-', '-', '500,000원', '-', '무료 유입'],
  ]);
});

test('키워드 표, 제안, 판별 비율, 미입력 경고', () => {
  const p = computePerformance(EXAMPLE);
  assert.deepEqual(p.keywords.map((k) => [k.name, percent(k.roas), k.badge]), [
    ['이혼전문변호사', '833%', '확대 검토'],
    ['형사변호사', '250%', '표본 부족'],
  ]);
  assert.equal(p.suggestion, '네이버 검색광고 ROAS 600%로 가장 높고, 구글 광고는 300%로 가장 낮아요. 구글 광고 예산 일부를 네이버 검색광고로 옮기는 걸 검토해 보세요.');
  assert.equal(percent(p.attribution.autoRate, 1), '74.1%');
  assert.equal(p.stale, 15);
  assert.equal(computePerformance({ ...EXAMPLE, has_keyword_spend: false }).keywords.length, 0, '키워드 광고비를 안 넣었으면 표 없음');
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

test('제안은 표본이 충분한 유료 채널이 둘 이상일 때만, 비교 근거를 함께 준다', () => {
  assert.deepEqual(computePerformance(EXAMPLE).suggestionBasis, {
    compared: ['네이버 검색광고', '구글 광고'],
    tooFew: [{ name: '메타 광고', leads: 4 }], // 카카오는 광고비가 없어 비교 대상 아님
  });
  const only = computePerformance({ ...EXAMPLE, channels: EXAMPLE.channels.filter((c) => c.id !== 'google_ads') });
  assert.equal(only.suggestion, null);
  assert.deepEqual(only.suggestionBasis, { compared: ['네이버 검색광고'], tooFew: [{ name: '메타 광고', leads: 4 }] });
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
