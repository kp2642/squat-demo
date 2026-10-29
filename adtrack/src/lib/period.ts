// 성과 화면 기간. 날짜는 한국 시간 'YYYY-MM-DD'.

export type PeriodKey = 'this' | 'last' | '30d' | 'custom';

export function todayKst(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

// 이번 달은 1일부터 오늘까지 (광고비도 오늘까지 일수만큼)
export function resolvePeriod(params: { period?: string; from?: string; to?: string }, now = new Date()) {
  const today = todayKst(now);
  const monthStart = `${today.slice(0, 7)}-01`;
  if (params.period === 'last') {
    const lastEnd = addDays(monthStart, -1);
    return { key: 'last' as PeriodKey, from: `${lastEnd.slice(0, 7)}-01`, to: lastEnd };
  }
  if (params.period === '30d') return { key: '30d' as PeriodKey, from: addDays(today, -29), to: today };
  if (params.period === 'custom' && isDate(params.from) && isDate(params.to) && params.from <= params.to) {
    return { key: 'custom' as PeriodKey, from: params.from, to: params.to };
  }
  return { key: 'this' as PeriodKey, from: monthStart, to: today };
}

export function periodLabel(from: string, to: string): string {
  const f = (d: string) => `${Number(d.slice(0, 4))}. ${Number(d.slice(5, 7))}. ${Number(d.slice(8, 10))}.`;
  return from === to ? f(from) : `${f(from)} ~ ${f(to)}`;
}

// 기간이 달의 일부만 덮는지 (광고비를 일수로 나눴다는 안내용)
export function coversWholeMonths(from: string, to: string): boolean {
  return from.endsWith('-01') && addDays(to, 1).endsWith('-01');
}
