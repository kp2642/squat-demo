// 성과 화면 계산 (요구사항 문서 '계산 규칙'). DB 함수 performance() 의 집계를 받아 비율·ROAS·판단 딱지·제안을 만든다.
//   문의당 비용 = 광고비 ÷ 문의 수        (문의 0 또는 광고비 0 → null, 화면 '-')
//   계약당 비용 = 광고비 ÷ 계약 수        (계약 0 또는 광고비 0 → null, 화면 '-')
//   전환율     = 계약 수 ÷ 문의 수 × 100  (문의 0 → 0)
//   ROAS      = 계약 매출 ÷ 광고비 × 100  (광고비 0 → null, 화면 '무료 유입')
//   판단 딱지: 광고비 없음 '무료 유입' > 문의 5건 미만 '표본 부족' > ROAS 기준(사업장 설정)

export const MIN_SAMPLE = 5;

export type Totals = { spend: number; leads: number; contracts: number; revenue: number };

export type RawChannel = Totals & { id: string; name: string; kind: 'paid' | 'free'; code: string | null; hidden: boolean };

export type RawPerformance = {
  from: string;
  to: string;
  settings: { roas_high: number; roas_low: number; contract_term: string };
  channels: RawChannel[];
  unknown: Omit<Totals, 'spend'> | null;
  keywords: (Totals & { keyword: string })[];
  has_keyword_spend: boolean;
  attribution: Partial<Record<'auto' | 'coupon' | 'asked' | 'manual' | 'unknown', number>>;
  stale: number;
};

export type Badge = '확대 검토' | '유지' | '점검 필요' | '무료 유입' | '표본 부족';

export type Metrics = Totals & {
  cpl: number | null; // 문의당 비용
  cpa: number | null; // 계약당 비용
  conversion: number; // 전환율 %
  roas: number | null; // %
  badge: Badge;
};

export type Row = Metrics & { id: string | null; name: string };

export type Performance = {
  from: string;
  to: string;
  contractTerm: string;
  total: Omit<Metrics, 'badge'>;
  channels: Row[]; // 문의나 광고비가 있는 채널, 출처 미확인은 맨 뒤
  keywords: Row[]; // 키워드 광고비를 넣은 달이 있을 때만
  suggestion: string | null;
  // 제안이 무엇을 비교했는지 화면에 함께 보여 주기 위한 근거
  suggestionBasis: { compared: string[]; tooFew: { name: string; leads: number }[] };
  attribution: { auto: number; coupon: number; asked: number; manual: number; unknown: number; autoRate: number };
  stale: number;
};

const ratio = (a: number, b: number) => (b === 0 ? null : a / b);

export function metrics(t: Totals, settings: { roas_high: number; roas_low: number }): Metrics {
  const roas = t.spend === 0 ? null : (t.revenue / t.spend) * 100;
  let badge: Badge;
  if (t.spend === 0) badge = '무료 유입';
  else if (t.leads < MIN_SAMPLE) badge = '표본 부족';
  else if (roas! >= settings.roas_high) badge = '확대 검토';
  else if (roas! >= settings.roas_low) badge = '유지';
  else badge = '점검 필요';
  return {
    ...t,
    // 광고비가 없는 채널(무료 유입)은 0원이 아니라 '-'
    cpl: t.spend === 0 ? null : ratio(t.spend, t.leads),
    cpa: t.spend === 0 ? null : ratio(t.spend, t.contracts),
    conversion: t.leads === 0 ? 0 : (t.contracts / t.leads) * 100,
    roas,
    badge,
  };
}

// 받침에 맞는 조사: josa('구글 광고', '은', '는') → '구글 광고는', josa('당근마켓', '은', '는') → '당근마켓은'
export function josa(word: string, withFinal: string, withoutFinal: string): string {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return `${word}${withoutFinal}`; // 한글이 아니면 받침 없는 쪽
  const final = code % 28;
  // '으로/로' 는 받침이 ㄹ(8)이면 '로'
  const hasFinal = withFinal === '으로' ? final !== 0 && final !== 8 : final !== 0;
  return `${word}${hasFinal ? withFinal : withoutFinal}`;
}

// 제안 비교 대상: 광고비를 쓴 채널(블로그 체험단비처럼 무료 채널에 쓴 돈 포함) 중 문의 MIN_SAMPLE 건 이상.
// 문의가 모자라 뺀 채널은 따로 알려 준다.
export function suggestionBasis(rows: Row[]): Performance['suggestionBasis'] {
  const spent = rows.filter((r) => r.id && r.spend > 0);
  return {
    compared: spent.filter((r) => r.leads >= MIN_SAMPLE).map((r) => r.name),
    tooFew: spent.filter((r) => r.leads < MIN_SAMPLE).map((r) => ({ name: r.name, leads: r.leads })),
  };
}

// 한 줄 제안: 비교 대상 중 ROAS 가장 높은 곳과 가장 낮은 곳.
// 가장 낮은 곳도 '확대 검토' 기준 이상이면 줄일 곳이 아니라 늘릴 곳을 제안한다 (계약 단가가 큰 업종).
export function suggest(rows: Row[], roasHigh: number): string | null {
  const names = new Set(suggestionBasis(rows).compared);
  const compared = rows.filter((r) => r.id && names.has(r.name) && r.roas != null).sort((a, b) => b.roas! - a.roas!);
  if (compared.length < 2) return null;
  const best = compared[0];
  const worst = compared[compared.length - 1];
  const pct = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}%`;
  if (worst.roas! >= roasHigh) {
    return `비교한 채널이 모두 ROAS ${pct(roasHigh)} 이상이에요. 가장 높은 ${best.name}(${pct(best.roas!)})부터 예산을 늘리는 걸 검토해 보세요.`;
  }
  if (best.roas === worst.roas) return null;
  return `${best.name} ROAS ${pct(best.roas!)}로 가장 높고, ${josa(worst.name, '은', '는')} ${pct(worst.roas!)}로 가장 낮아요. `
    + `${worst.name} 예산 일부를 ${josa(best.name, '으로', '로')} 옮기는 걸 검토해 보세요.`;
}

export function computePerformance(raw: RawPerformance): Performance {
  const s = raw.settings;
  const rows: Row[] = raw.channels
    .filter((c) => c.leads > 0 || c.spend > 0)
    .map((c) => ({ id: c.id, name: c.name, ...metrics(c, s) }));
  if (raw.unknown && raw.unknown.leads > 0) rows.push({ id: null, name: '출처 미확인', ...metrics({ ...raw.unknown, spend: 0 }, s) });

  const sum = (key: keyof Totals) => raw.channels.reduce((n, c) => n + Number(c[key]), 0) + (key === 'spend' ? 0 : Number(raw.unknown?.[key] ?? 0));
  const { badge: _badge, ...total } = metrics({ spend: sum('spend'), leads: sum('leads'), contracts: sum('contracts'), revenue: sum('revenue') }, s);

  const a = raw.attribution;
  const attribution = {
    auto: a.auto ?? 0, coupon: a.coupon ?? 0, asked: a.asked ?? 0, manual: a.manual ?? 0, unknown: a.unknown ?? 0,
    autoRate: total.leads === 0 ? 0 : ((a.auto ?? 0) / total.leads) * 100,
  };

  return {
    from: raw.from,
    to: raw.to,
    contractTerm: s.contract_term,
    total,
    channels: rows,
    keywords: raw.has_keyword_spend ? raw.keywords.map((k) => ({ id: null, name: k.keyword, ...metrics(k, s) })) : [],
    suggestion: suggest(rows, s.roas_high),
    suggestionBasis: suggestionBasis(rows),
    attribution,
    stale: raw.stale,
  };
}

// 화면 표시
export const won = (n: number | null) => (n == null ? '-' : `${Math.round(n).toLocaleString('ko-KR')}원`);
export const percent = (n: number | null, digits = 0) =>
  n == null ? '-' : `${n.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
