// 네이버 검색광고 키워드 보고서(CSV) 읽기.
// 실제 파일 형식은 받는 화면(다차원 보고서, 키워드 목록 다운로드)과 시기에 따라 조금씩 달라서 넓게 받는다.
//   - 인코딩: UTF-8(BOM 있거나 없음) 또는 EUC-KR(CP949)
//   - 구분자: 쉼표 또는 탭
//   - 맨 위에 보고서 제목·기간 줄이 있을 수 있음 → '키워드' 칸이 있는 줄을 머리글로 찾는다
//   - 숫자: "1,234", 1234.0, "-" (없음)
//   - 같은 키워드가 광고그룹·날짜별로 여러 줄 → 합친다. 합계·총계 줄은 뺀다
// 머리글을 못 찾으면 찾은 칸 이름을 오류에 넣어, 실제 파일이 다를 때 바로 고칠 수 있게 한다.

export type KeywordRow = { keyword: string; amount: number; clicks: number | null; impressions: number | null };

export type ParseResult = {
  rows: KeywordRow[];
  total: number;
  costColumn: string; // 어느 칸을 비용으로 읽었는지 (VAT 포함 여부 안내)
  period: { from: string; to: string } | null; // 파일에서 찾은 기간 (YYYY-MM-DD)
  skipped: number; // 키워드가 없거나 합계라서 뺀 줄
};

export class CsvError extends Error {}

export function decode(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('euc-kr').decode(bytes);
  }
  return text.replace(/^﻿/, '');
}

// RFC 4180 식 CSV (따옴표 안의 구분자·줄바꿈, "" 이스케이프)
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

// 따옴표 없이 쓴 머리글 '총비용(VAT포함,원)' 은 쉼표에서 두 칸으로 갈라진다. 괄호가 닫힐 때까지 다시 붙인다.
export function joinParenCells(cells: string[]): string[] {
  const out: string[] = [];
  let open = 0;
  for (const cell of cells) {
    if (open > 0) out[out.length - 1] += `,${cell}`;
    else out.push(cell);
    open += (cell.match(/\(/g)?.length ?? 0) - (cell.match(/\)/g)?.length ?? 0);
    if (open < 0) open = 0;
  }
  return out;
}

const KEYWORD_HEADERS = ['키워드', '키워드명', 'keyword'];
const SKIP_KEYWORDS = new Set(['', '-', '합계', '총계', '전체', 'total', '소계']);

function findColumn(header: string[], test: (h: string) => boolean): number {
  return header.findIndex((h) => test(norm(h)));
}

export function parseNumber(value: string | undefined): number | null {
  if (value == null) return null;
  const s = value.replace(/[",\s원₩%]/g, '');
  if (s === '' || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const DATE = String.raw`(20\d{2})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})`;
const iso = (m: RegExpMatchArray, i: number) => `${m[i]}-${m[i + 1].padStart(2, '0')}-${m[i + 2].padStart(2, '0')}`;

// 제목 줄의 '2024.10.01. ~ 2024.10.31.' 같은 범위만 믿는다 (다운로드 일시 같은 다른 날짜와 헷갈리지 않게)
function findRange(lines: string[][]): ParseResult['period'] {
  const re = new RegExp(`${DATE}\\.?\\s*[~～-]\\s*${DATE}`);
  for (const line of lines) {
    for (const cell of line) {
      const m = cell.match(re);
      if (m) return { from: iso(m, 1), to: iso(m, 4) };
    }
  }
  return null;
}

// 날짜 칸이 있는 파일: 가장 이른 날 ~ 가장 늦은 날
function dateSpan(cells: string[]): ParseResult['period'] {
  const re = new RegExp(DATE);
  const dates = cells.map((c) => c.match(re)).filter((m): m is RegExpMatchArray => !!m).map((m) => iso(m, 1)).sort();
  return dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null;
}

export function parseNaverKeywordCsv(bytes: Uint8Array): ParseResult {
  const text = decode(bytes);
  if (text.startsWith('PK')) throw new CsvError('엑셀(.xlsx) 파일이에요. 네이버 광고센터에서 CSV 로 다운로드해 주세요');
  const firstLines = text.split(/\r?\n/, 10).join('\n');
  const delimiter = (firstLines.match(/\t/g)?.length ?? 0) > (firstLines.match(/,/g)?.length ?? 0) ? '\t' : ',';
  const lines = parseDelimited(text, delimiter);
  if (!lines.length) throw new CsvError('빈 파일이에요');

  const headerIndex = lines.findIndex((l) => l.some((c) => KEYWORD_HEADERS.includes(norm(c))));
  if (headerIndex < 0) {
    throw new CsvError(`‘키워드’ 칸을 찾지 못했어요. 파일 첫 줄: ${lines[0].slice(0, 8).join(' | ')}`);
  }
  const header = joinParenCells(lines[headerIndex]);
  const kwCol = findColumn(header, (h) => KEYWORD_HEADERS.includes(h));
  // 총비용(VAT포함,원) 같은 칸. 평균클릭비용·전환당비용은 아니다.
  const costCol = findColumn(header, (h) => /^(총비용|총광고비|비용|광고비|cost)/.test(h) && !/평균|당/.test(h));
  if (costCol < 0) throw new CsvError(`비용 칸(총비용)을 찾지 못했어요. 찾은 칸: ${header.join(', ')}`);
  const clickCol = findColumn(header, (h) => /^클릭수/.test(h) || h === 'clicks');
  const impCol = findColumn(header, (h) => /^노출수/.test(h) || h === 'impressions');
  // 날짜별로 받은 파일이면 그 칸에서 기간을 찾는다
  const dateCol = findColumn(header, (h) => /^(일별|일자|날짜|기간|date)/.test(h));

  const sums = new Map<string, KeywordRow>();
  let skipped = 0;
  for (const line of lines.slice(headerIndex + 1)) {
    const keyword = (line[kwCol] ?? '').trim();
    if (SKIP_KEYWORDS.has(keyword.toLowerCase()) || line.some((c) => /^(합계|총계)$/.test(c.trim()))) {
      skipped++;
      continue;
    }
    if (keyword.length > 100) throw new CsvError(`키워드가 너무 길어요: ${keyword.slice(0, 30)}…`);
    const cost = parseNumber(line[costCol]);
    const clicks = clickCol >= 0 ? parseNumber(line[clickCol]) : null;
    const imps = impCol >= 0 ? parseNumber(line[impCol]) : null;
    const prev = sums.get(keyword);
    const add = (a: number | null, b: number | null) => (a == null && b == null ? null : (a ?? 0) + (b ?? 0));
    sums.set(keyword, {
      keyword,
      amount: (prev?.amount ?? 0) + (cost ?? 0),
      clicks: add(prev?.clicks ?? null, clicks),
      impressions: add(prev?.impressions ?? null, imps),
    });
  }

  const rows = [...sums.values()]
    .map((r) => ({
      ...r,
      amount: Math.round(r.amount),
      clicks: r.clicks == null ? null : Math.round(r.clicks),
      impressions: r.impressions == null ? null : Math.round(r.impressions),
    }))
    .sort((a, b) => b.amount - a.amount);
  if (!rows.length) throw new CsvError('키워드 줄이 없어요');

  const period = dateCol >= 0
    ? dateSpan(lines.slice(headerIndex + 1).map((l) => l[dateCol] ?? ''))
    : findRange(lines.slice(0, headerIndex));
  return {
    rows,
    total: rows.reduce((s, r) => s + r.amount, 0),
    costColumn: header[costCol].trim(),
    period,
    skipped,
  };
}

// 파일 기간이 고른 달과 맞는지. 기간을 못 찾았으면 고른 달을 믿는다.
export function checkPeriod(period: ParseResult['period'], month: string): string | null {
  if (!period) return null;
  const [from, to] = [period.from.slice(0, 7), period.to.slice(0, 7)];
  if (from !== to) return `파일에 여러 달(${period.from} ~ ${period.to})이 섞여 있어요. 한 달씩 받아 주세요`;
  if (from !== month) return `파일 기간(${period.from} ~ ${period.to})이 고른 달(${month})과 달라요`;
  return null;
}
