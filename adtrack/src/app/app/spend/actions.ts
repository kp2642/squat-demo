'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/session';
import { back, str } from '@/lib/form';
import { parseAmount } from '@/lib/domain';
import { firstDay, isMonth, currentMonth } from '@/lib/month';
import { CsvError, checkPeriod, parseNaverKeywordCsv } from '@/lib/naver-csv';

const MAX_CSV_BYTES = 5 * 1024 * 1024;
const message = (err: unknown) => (err instanceof Error ? err.message : '저장하지 못했어요');

function monthOf(form: FormData): string {
  const m = str(form, 'month');
  return isMonth(m) ? m : currentMonth();
}

function done(month: string, params: Record<string, string>): never {
  revalidatePath('/app', 'layout');
  back(`/app/spend?month=${month}`, params);
}

// 채널·월 광고비 표 한 번에 저장. 빈 칸은 그 달 금액을 지운다.
export async function saveSpend(form: FormData) {
  const month = monthOf(form);
  const { db } = await requireAdmin();
  const items: { channel_id: string; amount: number | null }[] = [];
  for (const [key, value] of form.entries()) {
    if (!key.startsWith('amount:') || typeof value !== 'string') continue;
    const amount = parseAmount(value);
    if (value.trim() && amount === null) done(month, { error: `금액을 숫자로 적어 주세요: ${value}` });
    items.push({ channel_id: key.slice('amount:'.length), amount });
  }
  try {
    await db.rpc('save_ad_spend', { p_month: firstDay(month), p_items: items });
  } catch (err) {
    done(month, { error: message(err) });
  }
  done(month, { notice: '광고비를 저장했어요' });
}

export async function copyPrevMonth(form: FormData) {
  const month = monthOf(form);
  const { db } = await requireAdmin();
  const n = await db.rpc<number>('copy_prev_month_spend', { p_month: firstDay(month) });
  done(month, { notice: n ? `지난 달 금액을 ${n}개 채널에 복사했어요 (이미 넣은 채널은 그대로)` : '복사할 금액이 없어요 (비어 있는 채널만 채워요)' });
}

export async function uploadKeywordCsv(form: FormData) {
  const month = monthOf(form);
  const { db } = await requireAdmin();
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) done(month, { error: 'CSV 파일을 골라 주세요' });
  if (file.size > MAX_CSV_BYTES) done(month, { error: '파일이 너무 커요 (5MB 까지)' });

  let parsed: ReturnType<typeof parseNaverKeywordCsv>;
  try {
    parsed = parseNaverKeywordCsv(new Uint8Array(await file.arrayBuffer()));
  } catch (err) {
    done(month, { error: err instanceof CsvError ? err.message : `파일을 읽지 못했어요: ${message(err)}` });
  }
  const periodError = checkPeriod(parsed.period, month);
  if (periodError) done(month, { error: periodError });

  const setChannel = form.get('set_channel') === 'on';
  try {
    await db.rpc('import_keyword_spend', { p_month: firstDay(month), p_rows: parsed.rows, p_set_channel: setChannel });
  } catch (err) {
    done(month, { error: message(err) });
  }
  const parts = [
    `키워드 ${parsed.rows.length.toLocaleString('ko-KR')}개, 합계 ${parsed.total.toLocaleString('ko-KR')}원을 반영했어요`,
    `비용 칸: ${parsed.costColumn}`,
  ];
  if (parsed.skipped) parts.push(`합계·빈 키워드 줄 ${parsed.skipped}개 제외`);
  if (setChannel) parts.push('네이버 검색광고 월 광고비도 이 합계로 맞췄어요');
  done(month, { notice: parts.join(' · ') });
}

export async function saveKeyword(form: FormData) {
  const month = monthOf(form);
  const { db } = await requireAdmin();
  const keyword = str(form, 'keyword');
  const amount = parseAmount(str(form, 'amount'));
  const clicks = str(form, 'clicks') ? parseAmount(str(form, 'clicks')) : null;
  if (!keyword || amount === null) done(month, { error: '키워드와 금액을 적어 주세요' });
  try {
    await db.rpc('save_keyword_spend', { p_month: firstDay(month), p_keyword: keyword, p_amount: amount, p_clicks: clicks });
  } catch (err) {
    done(month, { error: message(err) });
  }
  done(month, { notice: `‘${keyword}’ 광고비를 저장했어요` });
}

export async function deleteKeyword(form: FormData) {
  const month = monthOf(form);
  const { db } = await requireAdmin();
  const keyword = str(form, 'keyword') || null;
  const n = await db.rpc<number>('delete_keyword_spend', { p_month: firstDay(month), p_keyword: keyword });
  done(month, { notice: keyword ? `‘${keyword}’ 을(를) 지웠어요` : `이 달 키워드 ${n}개를 지웠어요` });
}

const utmList = (s: string) => s.split(/[,\s]+/).filter(Boolean);

export async function addChannel(form: FormData) {
  const month = monthOf(form);
  const { db } = await requireAdmin();
  const name = str(form, 'name');
  if (!name) done(month, { error: '채널 이름을 적어 주세요' });
  try {
    await db.rpc('add_channel', { p_name: name, p_kind: str(form, 'kind') === 'free' ? 'free' : 'paid', p_utm_sources: utmList(str(form, 'utm_sources')) });
  } catch (err) {
    done(month, { error: message(err) });
  }
  done(month, { notice: `‘${name}’ 채널을 추가했어요` });
}

export async function updateChannel(form: FormData) {
  const month = monthOf(form);
  const { db } = await requireAdmin();
  const name = str(form, 'name');
  if (!name) done(month, { error: '채널 이름을 적어 주세요' });
  try {
    await db.rpc('update_channel', {
      p_id: str(form, 'id'),
      p_name: name,
      p_kind: str(form, 'kind') === 'free' ? 'free' : 'paid',
      p_utm_sources: utmList(str(form, 'utm_sources')),
      p_hidden: form.get('hidden') === 'on',
    });
  } catch (err) {
    done(month, { error: message(err) });
  }
  done(month, { notice: `‘${name}’ 채널을 저장했어요` });
}
