'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireMember } from '@/lib/session';
import { back, str } from '@/lib/form';
import { parseAmount } from '@/lib/domain';
import { contactArgs, toView, type LeadRow, type LeadView } from '@/lib/leads';
import { FAIL_REASONS, STATUSES, type LeadStatus } from '@/lib/labels';

const message = (err: unknown) => (err instanceof Error ? err.message : '저장하지 못했어요');

// 문의함 카드의 상태 버튼. 화면을 다시 그리지 않고 바뀐 문의를 돌려준다.
export async function setLeadStatus(
  id: string,
  status: LeadStatus,
  amount?: number | null,
  failReason?: string | null,
): Promise<{ lead?: LeadView; error?: string }> {
  if (!STATUSES.includes(status)) return { error: '알 수 없는 상태예요' };
  if (status === 'contracted' && (amount == null || !Number.isSafeInteger(amount) || amount < 0)) {
    return { error: '금액을 숫자로 적어 주세요' };
  }
  if (failReason && !(FAIL_REASONS as readonly string[]).includes(failReason)) return { error: '알 수 없는 실패 사유예요' };
  const { db } = await requireMember();
  try {
    const row = await db.rpc<LeadRow>('update_lead_status', {
      p_id: id,
      p_status: status,
      p_amount: status === 'contracted' ? amount : null,
      p_fail_reason: status === 'failed' ? failReason ?? null : null,
    });
    revalidatePath('/app', 'layout');
    return { lead: toView(row) };
  } catch (err) {
    return { error: message(err) };
  }
}

export async function createLead(form: FormData) {
  const { db } = await requireMember();
  const name = str(form, 'name');
  const phone = str(form, 'phone');
  const { digits, args } = contactArgs(name, phone);
  const retry = (error: string): never => back('/app/inquiries/new', {
    error, name, phone, method: str(form, 'method'), channel: str(form, 'channel_id'),
    coupon: str(form, 'coupon'), inquiry_type: str(form, 'inquiry_type'),
  });
  if (phone && !digits) retry('연락처를 확인해 주세요');
  if (!name && !digits) retry('이름이나 연락처 중 하나는 적어 주세요');

  let result: { lead_id: string; merged: boolean };
  try {
    result = await db.rpc('create_manual_lead', {
      p_method: str(form, 'method'),
      p_channel_id: str(form, 'channel_id') || null,
      p_coupon: str(form, 'coupon') || null,
      p_inquiry_type: str(form, 'inquiry_type') || null,
      ...args,
    });
  } catch (err) {
    retry(message(err));
  }
  revalidatePath('/app', 'layout');
  if (result!.merged) {
    back(`/app/inquiries/${result!.lead_id}`, { notice: '이미 있는 연락처라 새 문의 대신 다시 연락으로 기록했어요' });
  }
  redirect(`/app/inquiries?notice=${encodeURIComponent('문의를 등록했어요')}`);
}

async function detailAction(form: FormData, run: (db: Awaited<ReturnType<typeof requireMember>>['db'], id: string) => Promise<unknown>, notice: string) {
  const ctx = await requireMember();
  const id = str(form, 'id');
  const path = `/app/inquiries/${id}`;
  try {
    await run(ctx.db, id);
  } catch (err) {
    back(path, { error: message(err) });
  }
  revalidatePath('/app', 'layout');
  back(path, { notice });
}

export async function updateContact(form: FormData) {
  const name = str(form, 'name');
  const phone = str(form, 'phone');
  const { digits, args } = contactArgs(name, phone);
  if (phone && !digits) back(`/app/inquiries/${str(form, 'id')}`, { error: '연락처를 확인해 주세요' });
  await detailAction(form, (db, id) => db.rpc('update_lead_contact', {
    p_id: id, ...args, p_inquiry_type: str(form, 'inquiry_type') || null,
  }), '고객 정보를 저장했어요');
}

export async function updateChannel(form: FormData) {
  await detailAction(form, (db, id) => db.rpc('update_lead_channel', {
    p_id: id, p_channel_id: str(form, 'channel_id') || null,
  }), '출처를 바꿨어요 (직접 선택)');
}

export async function updateAsked(form: FormData) {
  await detailAction(form, (db, id) => db.rpc('update_lead_asked', {
    p_id: id, p_channel_id: str(form, 'channel_id') || null,
  }), '고객 응답을 저장했어요');
}

export async function updateStatusForm(form: FormData) {
  const amount = parseAmount(str(form, 'amount'));
  const status = str(form, 'status') as LeadStatus;
  const result = await setLeadStatus(str(form, 'id'), status, amount, str(form, 'fail_reason') || null);
  const path = `/app/inquiries/${str(form, 'id')}`;
  back(path, result.error ? { error: result.error } : { notice: '상태를 저장했어요' });
}

export async function deleteLead(form: FormData) {
  const { db, member } = await requireMember();
  if (member.role !== 'admin') back(`/app/inquiries/${str(form, 'id')}`, { error: '관리자만 지울 수 있어요' });
  const ok = await db.rpc<boolean>('delete_lead', { p_id: str(form, 'id') });
  revalidatePath('/app', 'layout');
  back('/app/inquiries', ok ? { notice: '문의를 지웠어요' } : { error: '지우지 못했어요' });
}
