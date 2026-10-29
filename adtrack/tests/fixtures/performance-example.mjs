// 성과 화면 예시 데이터. 손으로 계산한 값은 tests/unit/performance.test.ts 맨 위 주석에 있다.
// 2026년 9월 문의 27건 + 기간 밖 문의 2건(한국 시간 경계 확인용), 9·10월 광고비, 9월 키워드 광고비.

// 한국 시간 → UTC ISO
const kst = (date, time = '10:00') => new Date(`${date}T${time}:00+09:00`).toISOString();

export async function seedPerformanceExample(db, ws) {
  const ch = Object.fromEntries((await db.query('select code, id from public.channels where workspace_id = $1 and code is not null', [ws])).rows.map((r) => [r.code, r.id]));
  let day = 2;
  const leads = [];
  const add = (channel, attribution, status, amount = null, keyword = null, at = null) => {
    leads.push({ channel: channel && ch[channel], attribution, status, amount, keyword, at: at ?? kst(`2026-09-${String(day).padStart(2, '0')}`) });
    day = day >= 29 ? 2 : day + 1;
  };

  // 네이버 검색광고 10건: 계약 3 (6,000,000), 실패 2, 진행 중 5
  add('naver_sa', 'auto', 'contracted', 3_000_000, '이혼전문변호사', kst('2026-09-01', '00:05')); // 9월 첫 5분 (UTC 로는 8월 31일)
  add('naver_sa', 'auto', 'contracted', 2_000_000, '이혼전문변호사');
  add('naver_sa', 'auto', 'failed', null, '이혼전문변호사');
  add('naver_sa', 'auto', 'new', null, '이혼전문변호사');
  add('naver_sa', 'auto', 'consulting', null, '이혼 전문변호사'); // 띄어쓰기 달라도 같은 키워드
  add('naver_sa', 'auto', 'new', null, '이혼전문변호사');
  add('naver_sa', 'auto', 'contracted', 1_000_000, '형사변호사');
  add('naver_sa', 'auto', 'failed', null, '형사변호사');
  add('naver_sa', 'auto', 'new', null, '형사변호사');
  add('naver_sa', 'auto', 'new', null, null); // n_media 만 있고 키워드 없음
  // 구글 6건: 계약 1 (1,500,000), 실패 1, 진행 4
  add('google_ads', 'auto', 'contracted', 1_500_000);
  add('google_ads', 'auto', 'failed');
  for (let i = 0; i < 4; i++) add('google_ads', 'auto', 'new');
  // 메타 4건: 계약 1 (400,000), 진행 3
  add('meta_ads', 'auto', 'contracted', 400_000);
  for (let i = 0; i < 3; i++) add('meta_ads', 'auto', 'consulting');
  // 블로그 3건 (쿠폰 1, 고객 응답 2): 계약 1 (2,000,000), 진행 2
  add('blog', 'asked', 'contracted', 2_000_000);
  add('blog', 'coupon', 'new');
  add('blog', 'asked', 'new');
  // 지인 소개 2건 (직접 선택): 실패 2
  add('referral', 'manual', 'failed');
  add('referral', 'manual', 'failed');
  // 출처 미확인 2건: 계약 1 (500,000), 진행 1
  add(null, 'unknown', 'contracted', 500_000);
  add(null, 'unknown', 'new');
  // 기간 밖 (9월 성과에 들어가면 안 됨)
  add('naver_sa', 'auto', 'contracted', 9_999_999, '이혼전문변호사', kst('2026-08-31', '23:30'));
  add('meta_ads', 'auto', 'contracted', 7_777_777, null, kst('2026-10-01', '00:10'));

  for (const l of leads) {
    await db.query(
      `insert into public.leads (workspace_id, method, channel_id, attribution, status, contract_amount, fail_reason, keyword, created_at)
       values ($1, 'form', $2, $3, $4, $5, $6, $7, $8)`,
      [ws, l.channel, l.attribution, l.status, l.amount, l.status === 'failed' ? '가격' : null, l.keyword, l.at],
    );
  }

  const spend = [
    ['naver_sa', '2026-09-01', 1_000_000], ['google_ads', '2026-09-01', 500_000], ['meta_ads', '2026-09-01', 300_000],
    ['naver_sa', '2026-10-01', 620_000], ['naver_sa', '2026-08-01', 5_000_000],
  ];
  for (const [code, month, amount] of spend) {
    await db.query('insert into public.ad_spend (workspace_id, channel_id, month, amount) values ($1, $2, $3, $4)', [ws, ch[code], month, amount]);
  }
  for (const [keyword, amount] of [['이혼전문변호사', 600_000], ['형사변호사', 400_000]]) {
    await db.query("insert into public.keyword_spend (workspace_id, month, keyword, amount) values ($1, '2026-09-01', $2, $3)", [ws, keyword, amount]);
  }
  return ch;
}
