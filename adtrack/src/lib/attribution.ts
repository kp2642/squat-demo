// 출처 판별 규칙표 (요구사항 문서 '추적 코드 동작'). 순서대로 처음 맞는 규칙이 출처가 된다.
// 결과의 code 는 channels.code, utm_source 는 사업장 채널의 utm_sources 매핑으로 DB 가 채널을 찾는다.

// 추적 코드가 쿠키에 저장해 보내는 유입 한 번
export type Touch = {
  t?: Record<string, string>; // 주소의 꼬리표
  r?: string; // 유입 주소 (document.referrer)
  p?: string; // 도착 페이지
  ts?: number; // 초 단위 시각
};

export type ChannelCode = 'naver_sa' | 'google_ads' | 'meta_ads' | 'blog' | 'organic' | 'direct';

export type Source = {
  rule: 1 | 2 | 3 | 4 | 5 | 6 | 7 | null; // null: 다른 사이트에서 왔지만 맞는 규칙 없음
  code: ChannelCode | null;
  utm_source?: string;
  keyword?: string;
  campaign?: string;
  ad_group?: string;
  ad_content?: string;
  rank?: string;
  engine?: string;
  evidence: string;
};

export const TRACKED_TAGS = [
  'n_media', 'n_query', 'n_rank', 'n_ad_group', 'n_ad', 'n_keyword_id', 'n_keyword', 'n_campaign_type',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'gclid', 'fbclid',
] as const;

const BLOG_HOSTS = [
  'blog.naver.com', 'm.blog.naver.com', 'cafe.naver.com', 'm.cafe.naver.com', 'post.naver.com', 'm.post.naver.com',
  'in.naver.com', 'blog.daum.net', 'cafe.daum.net', 'm.cafe.daum.net', 'brunch.co.kr', 'velog.io', 'medium.com',
];
const BLOG_SUFFIXES = ['.tistory.com', '.blogspot.com', '.wordpress.com', '.medium.com'];

const SEARCH_ENGINES: { name: string; match: (host: string) => boolean }[] = [
  { name: '네이버', match: (h) => h === 'naver.com' || h.endsWith('.naver.com') },
  { name: '구글', match: (h) => /(^|\.)google\.[a-z.]+$/.test(h) },
  { name: '다음', match: (h) => h === 'daum.net' || h.endsWith('.daum.net') },
  { name: '빙', match: (h) => h === 'bing.com' || h.endsWith('.bing.com') },
  { name: '줌', match: (h) => h === 'zum.com' || h.endsWith('.zum.com') },
  { name: '네이트', match: (h) => h === 'nate.com' || h.endsWith('.nate.com') },
  { name: '야후', match: (h) => /(^|\.)yahoo\.[a-z.]+$/.test(h) },
  { name: '덕덕고', match: (h) => h === 'duckduckgo.com' },
];

export function referrerHost(referrer: string | undefined): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

function isBlog(host: string): boolean {
  return BLOG_HOSTS.includes(host) || BLOG_SUFFIXES.some((s) => host.endsWith(s));
}

const clean = (v: string | undefined, max = 200) => {
  const s = v?.trim();
  return s ? s.slice(0, max) : undefined;
};

export function attribute(touch: Touch | null | undefined): Source {
  const t = touch?.t ?? {};

  if (t.n_keyword || t.n_media) {
    const keyword = clean(t.n_keyword) ?? clean(t.n_query);
    return {
      rule: 1,
      code: 'naver_sa',
      keyword,
      ad_group: clean(t.n_ad_group),
      rank: clean(t.n_rank, 10),
      campaign: clean(t.n_campaign_type),
      evidence: keyword ? `n_keyword=${keyword}` : `n_media=${clean(t.n_media)}`,
    };
  }

  if (t.utm_source) {
    const utm_source = clean(t.utm_source, 100)!.toLowerCase();
    const parts = [`utm_source=${utm_source}`];
    if (t.utm_campaign) parts.push(`utm_campaign=${clean(t.utm_campaign)}`);
    return {
      rule: 2,
      code: null,
      utm_source,
      campaign: clean(t.utm_campaign),
      ad_content: clean(t.utm_content),
      keyword: clean(t.utm_term),
      evidence: parts.join(', '),
    };
  }

  if (t.gclid) return { rule: 3, code: 'google_ads', evidence: `gclid=${clean(t.gclid, 24)}…` };
  if (t.fbclid) return { rule: 4, code: 'meta_ads', evidence: `fbclid=${clean(t.fbclid, 24)}…` };

  const host = referrerHost(touch?.r);
  if (host && isBlog(host)) return { rule: 5, code: 'blog', evidence: `유입 주소 ${host}` };
  if (host) {
    const engine = SEARCH_ENGINES.find((e) => e.match(host));
    if (engine) return { rule: 6, code: 'organic', engine: engine.name, evidence: `검색엔진 ${engine.name} (${host})` };
    return { rule: null, code: null, evidence: `유입 주소 ${host} (맞는 규칙 없음)` };
  }

  return { rule: 7, code: 'direct', evidence: '꼬리표·유입 주소 없음' };
}

// 출처 기준은 '마지막 광고 유입', 없으면 첫 유입
export function chooseTouch(first: Touch | null | undefined, last: Touch | null | undefined): Touch | null {
  return last ?? first ?? null;
}
