// 성과 화면 예시 데이터 3종과 손으로 계산한 화면 값. 단위 테스트(계산), DB 테스트(집계), 브라우저 테스트(화면)가 같이 쓴다.
// 기간은 모두 2026-09-01 ~ 2026-09-30 (한 달 전체라 광고비를 나누지 않음), 판단 기준 500% / 200%.

// 기본 채널 (create_workspace 와 같은 순서)
export const CHANNELS = [
  ['naver_sa', '네이버 검색광고', 'paid'], ['google_ads', '구글 광고', 'paid'], ['meta_ads', '메타 광고', 'paid'],
  ['kakao_ads', '카카오 광고', 'paid'], ['blog', '블로그·체험단', 'free'], ['naver_place', '네이버 예약·톡톡', 'free'],
  ['organic', '자연 검색', 'free'], ['referral', '지인 소개', 'free'], ['direct', '직접 방문', 'free'],
];

// g(채널, 판별 방식, 상태, 건수, 금액, 키워드): 같은 문의 n 건
const g = (code, attribution, status, n = 1, amount = null, keyword = null) => ({ code, attribution, status, n, amount, keyword });

export const EXAMPLES = {
  // ── 법률: 키워드 광고비, 표본 부족 채널, 기간 경계 ─────────────────────────────
  // 채널           광고비      문의 수임  매출
  // 네이버 검색광고  1,000,000   10   3   6,000,000 (3,000,000 + 2,000,000 + 1,000,000)
  // 구글 광고        500,000     6   1   1,500,000
  // 메타 광고        300,000     4   1     400,000
  // 블로그·체험단          0     3   1   2,000,000
  // 지인 소개              0     2   0           0
  // 출처 미확인            -     2   1     500,000
  // 합계           1,800,000    27   7  10,400,000
  // ROAS 10,400,000 ÷ 1,800,000 = 577.8% → 578% (1원당 5.8원), 문의당 1,800,000 ÷ 27 = 66,667원,
  // 수임당 1,800,000 ÷ 7 = 257,143원, 전환율 7 ÷ 27 = 25.9%
  // 네이버 문의당 100,000·수임당 333,333·30.0%·600% 확대 검토 / 구글 83,333·500,000·16.7%·300% 유지
  // 메타 75,000·300,000·25.0%·133% 문의 4건 표본 부족
  // 키워드: 이혼전문변호사 600,000원·6건·2건·5,000,000원 → 833% / 형사변호사 400,000·3·1·1,000,000 → 250% 표본 부족
  // 판별: 자동 20 (74%), 쿠폰 1 (4%), 고객 응답 2 (7%), 직접 선택 2 (7%), 미확인 2 (7%) / 미입력 15건
  legal: {
    industry: 'legal',
    term: '수임',
    spend: { naver_sa: 1_000_000, google_ads: 500_000, meta_ads: 300_000 },
    // 기간 계산 확인용 (9월 성과에는 들어가지 않음)
    otherSpend: [['naver_sa', '2026-10-01', 620_000], ['naver_sa', '2026-08-01', 5_000_000]],
    keywordSpend: [['이혼전문변호사', 600_000], ['형사변호사', 400_000]],
    leads: [
      { ...g('naver_sa', 'auto', 'contracted', 1, 3_000_000, '이혼전문변호사'), at: ['2026-09-01', '00:05'] }, // UTC 로는 8월 31일
      g('naver_sa', 'auto', 'contracted', 1, 2_000_000, '이혼전문변호사'),
      g('naver_sa', 'auto', 'failed', 1, null, '이혼전문변호사'),
      g('naver_sa', 'auto', 'new', 1, null, '이혼전문변호사'),
      g('naver_sa', 'auto', 'consulting', 1, null, '이혼 전문변호사'), // 띄어쓰기 달라도 같은 키워드
      g('naver_sa', 'auto', 'new', 1, null, '이혼전문변호사'),
      g('naver_sa', 'auto', 'contracted', 1, 1_000_000, '형사변호사'),
      g('naver_sa', 'auto', 'failed', 1, null, '형사변호사'),
      g('naver_sa', 'auto', 'new', 1, null, '형사변호사'),
      g('naver_sa', 'auto', 'new'), // 키워드 없음
      g('google_ads', 'auto', 'contracted', 1, 1_500_000), g('google_ads', 'auto', 'failed'), g('google_ads', 'auto', 'new', 4),
      g('meta_ads', 'auto', 'contracted', 1, 400_000), g('meta_ads', 'auto', 'consulting', 3),
      g('blog', 'asked', 'contracted', 1, 2_000_000), g('blog', 'coupon', 'new'), g('blog', 'asked', 'new'),
      g('referral', 'manual', 'failed', 2),
      g(null, 'unknown', 'contracted', 1, 500_000), g(null, 'unknown', 'new'),
    ],
    outside: [
      { ...g('naver_sa', 'auto', 'contracted', 1, 9_999_999, '이혼전문변호사'), at: ['2026-08-31', '23:30'] },
      { ...g('meta_ads', 'auto', 'contracted', 1, 7_777_777), at: ['2026-10-01', '00:10'] },
    ],
    expected: {
      tiles: {
        spend: '광고비 1,800,000원', leads: '문의 27건 전환율 25.9%', contracts: '수임 7건', revenue: '수임 매출 10,400,000원',
        roas: 'ROAS 578% 광고비 1원당 5.8원', cpl: '문의당 비용 66,667원', cpa: '수임당 비용 257,143원',
      },
      channels: [
        ['네이버 검색광고', '1,000,000원', '10', '3', '30.0%', '100,000원', '333,333원', '6,000,000원', '600%', '확대 검토'],
        ['구글 광고', '500,000원', '6', '1', '16.7%', '83,333원', '500,000원', '1,500,000원', '300%', '유지'],
        ['메타 광고', '300,000원', '4', '1', '25.0%', '75,000원', '300,000원', '400,000원', '133%', '표본 부족'],
        ['블로그·체험단', '0원', '3', '1', '33.3%', '-', '-', '2,000,000원', '-', '무료 유입'],
        ['지인 소개', '0원', '2', '0', '0.0%', '-', '-', '0원', '-', '무료 유입'],
        ['출처 미확인', '0원', '2', '1', '50.0%', '-', '-', '500,000원', '-', '무료 유입'],
      ],
      keywords: [
        ['이혼전문변호사', '600,000원', '6', '2', '33.3%', '100,000원', '300,000원', '5,000,000원', '833%', '확대 검토'],
        ['형사변호사', '400,000원', '3', '1', '33.3%', '133,333원', '400,000원', '1,000,000원', '250%', '표본 부족'],
      ],
      suggestion: '네이버 검색광고 ROAS 600%로 가장 높고, 구글 광고는 300%로 가장 낮아요. 구글 광고 예산 일부를 네이버 검색광고로 옮기는 걸 검토해 보세요.',
      basis: { compared: ['네이버 검색광고', '구글 광고'], tooFew: [{ name: '메타 광고', leads: 4 }] },
      attribution: ['자동 (추적 코드) 20건 · 74%', '쿠폰 문구 1건 · 4%', '고객 응답 2건 · 7%', '직원 직접 선택 2건 · 7%', '출처 미확인 2건 · 7%'],
      stale: 15,
    },
  },

  // ── 병원·의원: 객단가 작고 문의 많음, 쿠폰 많음, 점검 필요 채널 둘 ─────────────────
  // 채널           광고비      문의 결제  매출
  // 네이버 검색광고  2,000,000   40  16   9,600,000 (16 × 600,000)
  // 메타 광고      1,500,000   25   5   2,250,000 (5 × 450,000)
  // 카카오 광고      400,000    8   1     300,000
  // 블로그·체험단          0    12   4   2,000,000 (4 × 500,000)
  // 자연 검색              0     6   2   1,600,000 (2 × 800,000)
  // 출처 미확인            -     3   0           0
  // 합계           3,900,000    94  28  15,750,000
  // ROAS 15,750,000 ÷ 3,900,000 = 403.8% → 404% (1원당 4.0원), 문의당 3,900,000 ÷ 94 = 41,489.4 → 41,489원,
  // 결제당 3,900,000 ÷ 28 = 139,285.7 → 139,286원, 전환율 28 ÷ 94 = 29.8%
  // 네이버 문의당 50,000·결제당 125,000·40.0%·480% → 500% 바로 아래라 유지
  // 메타 60,000·300,000·20.0%·150% 점검 필요 / 카카오 50,000·400,000·12.5%·75% 점검 필요
  // 블로그 33.3% 무료 유입 / 자연 검색 33.3% 무료 유입 / 미확인 0.0%
  // 제안: 네이버 480% 가장 높고 카카오 75% 가장 낮음. 뺀 채널 없음.
  // 판별: 자동 79 (84%), 쿠폰 5 (5%), 고객 응답 7 (7%), 직접 선택 0 (0%), 미확인 3 (3%)
  // 미입력: 네이버 4 + 블로그 2 + 미확인 3 = 9건. 키워드 광고비 없음 → 키워드 표 없음
  clinic: {
    industry: 'clinic',
    term: '결제',
    spend: { naver_sa: 2_000_000, meta_ads: 1_500_000, kakao_ads: 400_000 },
    keywordSpend: [],
    leads: [
      g('naver_sa', 'auto', 'contracted', 16, 600_000, '임플란트'), g('naver_sa', 'auto', 'failed', 20, null, '임플란트'), g('naver_sa', 'auto', 'new', 4),
      g('meta_ads', 'auto', 'contracted', 5, 450_000), g('meta_ads', 'auto', 'failed', 20),
      g('kakao_ads', 'auto', 'contracted', 1, 300_000), g('kakao_ads', 'auto', 'failed', 7),
      g('blog', 'coupon', 'contracted', 4, 500_000), g('blog', 'coupon', 'failed', 1), g('blog', 'asked', 'failed', 5), g('blog', 'asked', 'consulting', 2),
      g('organic', 'auto', 'contracted', 2, 800_000), g('organic', 'auto', 'failed', 4),
      g(null, 'unknown', 'new', 3),
    ],
    outside: [],
    expected: {
      tiles: {
        spend: '광고비 3,900,000원', leads: '문의 94건 전환율 29.8%', contracts: '결제 28건', revenue: '결제 매출 15,750,000원',
        roas: 'ROAS 404% 광고비 1원당 4.0원', cpl: '문의당 비용 41,489원', cpa: '결제당 비용 139,286원',
      },
      channels: [
        ['네이버 검색광고', '2,000,000원', '40', '16', '40.0%', '50,000원', '125,000원', '9,600,000원', '480%', '유지'],
        ['메타 광고', '1,500,000원', '25', '5', '20.0%', '60,000원', '300,000원', '2,250,000원', '150%', '점검 필요'],
        ['카카오 광고', '400,000원', '8', '1', '12.5%', '50,000원', '400,000원', '300,000원', '75%', '점검 필요'],
        ['블로그·체험단', '0원', '12', '4', '33.3%', '-', '-', '2,000,000원', '-', '무료 유입'],
        ['자연 검색', '0원', '6', '2', '33.3%', '-', '-', '1,600,000원', '-', '무료 유입'],
        ['출처 미확인', '0원', '3', '0', '0.0%', '-', '-', '0원', '-', '무료 유입'],
      ],
      keywords: [],
      suggestion: '네이버 검색광고 ROAS 480%로 가장 높고, 카카오 광고는 75%로 가장 낮아요. 카카오 광고 예산 일부를 네이버 검색광고로 옮기는 걸 검토해 보세요.',
      basis: { compared: ['네이버 검색광고', '메타 광고', '카카오 광고'], tooFew: [] },
      attribution: ['자동 (추적 코드) 79건 · 84%', '쿠폰 문구 5건 · 5%', '고객 응답 7건 · 7%', '직원 직접 선택 0건 · 0%', '출처 미확인 3건 · 3%'],
      stale: 9,
    },
  },

  // ── 인테리어: 객단가 크고 문의 적음, 체험단비(무료 채널에 쓴 돈), 모든 채널이 기준 이상 ──
  // 채널           광고비      문의 계약  매출
  // 네이버 검색광고  1,500,000    7   1  25,000,000
  // 메타 광고        800,000     3   0           0
  // 블로그·체험단    300,000     6   1  18,000,000 (체험단비)
  // 지인 소개              0     4   2  52,000,000 (30,000,000 + 22,000,000)
  // 합계           2,600,000    20   4  95,000,000
  // ROAS 95,000,000 ÷ 2,600,000 = 3,653.8% → 3,654% (1원당 36.5원), 문의당 2,600,000 ÷ 20 = 130,000원,
  // 계약당 2,600,000 ÷ 4 = 650,000원, 전환율 4 ÷ 20 = 20.0%
  // 네이버 문의당 1,500,000 ÷ 7 = 214,286원·계약당 1,500,000원·14.3%·1,667% 확대 검토
  // 메타 문의당 266,667원·계약당 '-'(계약 0)·0.0%·0% → 문의 3건 표본 부족
  // 블로그 문의당 50,000원·계약당 300,000원·16.7%·6,000% 확대 검토 (광고비를 썼으니 무료 유입 아님)
  // 지인 소개 50.0% 무료 유입
  // 제안: 비교한 네이버(1,667%)·블로그(6,000%) 모두 500% 이상 → 줄일 곳이 아니라 블로그부터 늘리기
  // 판별: 자동 10 (50%), 쿠폰 0 (0%), 고객 응답 6 (30%), 직접 선택 4 (20%), 미확인 0 (0%) / 미입력 0건 → 경고 없음
  interior: {
    industry: 'interior',
    term: '계약',
    spend: { naver_sa: 1_500_000, meta_ads: 800_000, blog: 300_000 },
    keywordSpend: [],
    leads: [
      g('naver_sa', 'auto', 'contracted', 1, 25_000_000), g('naver_sa', 'auto', 'failed', 6),
      g('meta_ads', 'auto', 'failed', 3),
      g('blog', 'asked', 'contracted', 1, 18_000_000), g('blog', 'asked', 'failed', 5),
      g('referral', 'manual', 'contracted', 1, 30_000_000), g('referral', 'manual', 'contracted', 1, 22_000_000), g('referral', 'manual', 'failed', 2),
    ],
    outside: [],
    expected: {
      tiles: {
        spend: '광고비 2,600,000원', leads: '문의 20건 전환율 20.0%', contracts: '계약 4건', revenue: '계약 매출 95,000,000원',
        roas: 'ROAS 3,654% 광고비 1원당 36.5원', cpl: '문의당 비용 130,000원', cpa: '계약당 비용 650,000원',
      },
      channels: [
        ['네이버 검색광고', '1,500,000원', '7', '1', '14.3%', '214,286원', '1,500,000원', '25,000,000원', '1,667%', '확대 검토'],
        ['메타 광고', '800,000원', '3', '0', '0.0%', '266,667원', '-', '0원', '0%', '표본 부족'],
        ['블로그·체험단', '300,000원', '6', '1', '16.7%', '50,000원', '300,000원', '18,000,000원', '6,000%', '확대 검토'],
        ['지인 소개', '0원', '4', '2', '50.0%', '-', '-', '52,000,000원', '-', '무료 유입'],
      ],
      keywords: [],
      suggestion: '비교한 채널이 모두 ROAS 500% 이상이에요. 가장 높은 블로그·체험단(6,000%)부터 예산을 늘리는 걸 검토해 보세요.',
      basis: { compared: ['네이버 검색광고', '블로그·체험단'], tooFew: [{ name: '메타 광고', leads: 3 }] },
      attribution: ['자동 (추적 코드) 10건 · 50%', '쿠폰 문구 0건 · 0%', '고객 응답 6건 · 30%', '직원 직접 선택 4건 · 20%', '출처 미확인 0건 · 0%'],
      stale: 0,
    },
  },
};

// 한국 시간 → UTC ISO
const kst = ([date, time]) => new Date(`${date}T${time}:00+09:00`).toISOString();

// 예시를 사업장에 넣는다. 날짜를 명시하지 않은 문의는 9월 2일~29일 10시에 고르게 퍼뜨린다.
export async function seedExample(db, ws, example) {
  const ch = Object.fromEntries((await db.query('select code, id from public.channels where workspace_id = $1 and code is not null', [ws])).rows.map((r) => [r.code, r.id]));
  let day = 2;
  const insert = async (l, at) => {
    await db.query(
      `insert into public.leads (workspace_id, method, channel_id, attribution, status, contract_amount, fail_reason, keyword, created_at)
       values ($1, 'form', $2, $3, $4, $5, $6, $7, $8)`,
      [ws, l.code && ch[l.code], l.attribution, l.status, l.amount, l.status === 'failed' ? '가격' : null, l.keyword, at],
    );
  };
  for (const l of [...example.leads, ...example.outside]) {
    for (let i = 0; i < l.n; i++) {
      await insert(l, kst(l.at ?? [`2026-09-${String(day).padStart(2, '0')}`, '10:00']));
      if (!l.at) day = day >= 29 ? 2 : day + 1;
    }
  }
  const spend = [...Object.entries(example.spend).map(([code, amount]) => [code, '2026-09-01', amount]), ...(example.otherSpend ?? [])];
  for (const [code, month, amount] of spend) {
    await db.query('insert into public.ad_spend (workspace_id, channel_id, month, amount) values ($1, $2, $3, $4)', [ws, ch[code], month, amount]);
  }
  for (const [keyword, amount] of example.keywordSpend) {
    await db.query("insert into public.keyword_spend (workspace_id, month, keyword, amount) values ($1, '2026-09-01', $2, $3)", [ws, keyword, amount]);
  }
  return ch;
}

// 법률 예시 (기존 테스트용 이름)
export const seedPerformanceExample = (db, ws) => seedExample(db, ws, EXAMPLES.legal);

// 단위 테스트용: 예시를 DB 집계 결과(performance() 의 모양)로 바꾼다. 9월 안의 문의만.
export function rawFromExample(example, settings = { roas_high: 500, roas_low: 200 }) {
  const sums = new Map();
  const add = (key, l) => {
    const s = sums.get(key) ?? { leads: 0, contracts: 0, revenue: 0 };
    s.leads += l.n;
    if (l.status === 'contracted') { s.contracts += l.n; s.revenue += l.n * l.amount; }
    sums.set(key, s);
  };
  const kw = new Map();
  const attribution = {};
  let stale = 0;
  for (const l of example.leads) {
    add(l.code, l);
    attribution[l.attribution] = (attribution[l.attribution] ?? 0) + l.n;
    if (l.status === 'new' || l.status === 'consulting') stale += l.n;
    if (l.code === 'naver_sa' && l.keyword) {
      const k = l.keyword.replace(/\s+/g, '').toLowerCase();
      const s = kw.get(k) ?? { keyword: l.keyword.replace(/\s+/g, ''), leads: 0, contracts: 0, revenue: 0 };
      s.leads += l.n;
      if (l.status === 'contracted') { s.contracts += l.n; s.revenue += l.n * l.amount; }
      kw.set(k, s);
    }
  }
  const zero = { leads: 0, contracts: 0, revenue: 0 };
  return {
    from: '2026-09-01',
    to: '2026-09-30',
    settings: { ...settings, contract_term: example.term },
    channels: CHANNELS.map(([code, name, kind]) => ({ id: code, name, kind, code, hidden: false, spend: example.spend[code] ?? 0, ...(sums.get(code) ?? zero) })),
    unknown: sums.get(null) ?? null,
    keywords: example.keywordSpend.map(([keyword, spend]) => ({ spend, ...(kw.get(keyword.toLowerCase()) ?? { ...zero }), keyword })),
    has_keyword_spend: example.keywordSpend.length > 0,
    attribution,
    stale,
  };
}
