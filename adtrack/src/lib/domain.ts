// 홈페이지 주소 입력(줄바꿈·쉼표 구분)을 도메인 목록으로. DB 의 normalize_domain 과 같은 규칙.
export function parseDomains(input: string): string[] {
  const out = new Set<string>();
  for (const raw of input.split(/[\s,]+/)) {
    const d = normalizeDomain(raw);
    if (d) out.add(d);
  }
  return [...out];
}

export function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .split('/')[0]
    .split('?')[0]
    .split(':')[0]
    .replace(/^www\./, '');
}

export function isValidDomain(d: string): boolean {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d);
}

export function parseAmount(input: string): number | null {
  const n = Number(input.replace(/[,\s원]/g, ''));
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
