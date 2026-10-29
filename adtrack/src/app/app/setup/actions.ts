'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/session';
import { back, errorMessage, str } from '@/lib/form';
import { isValidDomain, normalizeDomain, parseAmount } from '@/lib/domain';

const PAGE = '/app/setup';

function done(notice: string): never {
  revalidatePath('/app', 'layout');
  back(PAGE, { notice });
}

export async function updateWorkspace(form: FormData) {
  const { supabase, workspace } = await requireAdmin();
  const amount = parseAmount(str(form, 'avg_contract_amount'));
  const roasHigh = Number(str(form, 'roas_high'));
  const roasLow = Number(str(form, 'roas_low'));
  if (amount === null) back(PAGE, { error: '평균 계약 금액을 숫자로 적어 주세요' });
  if (!Number.isInteger(roasHigh) || !Number.isInteger(roasLow) || roasLow < 0 || roasLow >= roasHigh) {
    back(PAGE, { error: '판단 기준은 ‘점검 필요’ 기준이 ‘확대 검토’ 기준보다 작아야 해요' });
  }
  const { error } = await supabase
    .from('workspaces')
    .update({
      name: str(form, 'name'),
      industry: str(form, 'industry'),
      contract_term: str(form, 'contract_term'),
      avg_contract_amount: amount,
      roas_high: roasHigh,
      roas_low: roasLow,
    })
    .eq('id', workspace.id);
  if (error) back(PAGE, { error: errorMessage(error) });
  done('사업장 설정을 저장했어요');
}

export async function updateThankYou(form: FormData) {
  const { supabase, workspace } = await requireAdmin();
  const raw = str(form, 'thank_you_url');
  let url: string | null = null;
  if (raw) {
    try {
      url = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`).toString();
    } catch {
      back(PAGE, { error: '문의 완료 페이지 주소를 확인해 주세요' });
    }
  }
  const { error } = await supabase.from('workspaces').update({ thank_you_url: url }).eq('id', workspace.id);
  if (error) back(PAGE, { error: errorMessage(error) });
  done(url ? '문의 완료 페이지를 저장했어요. 추적 코드에 5분 안에 반영돼요' : '문의 완료 페이지 방식을 껐어요');
}

export async function addSite(form: FormData) {
  const { supabase, workspace } = await requireAdmin();
  const domain = normalizeDomain(str(form, 'domain'));
  if (!isValidDomain(domain)) back(PAGE, { error: '홈페이지 주소를 확인해 주세요' });
  const { error } = await supabase.from('sites').insert({ workspace_id: workspace.id, domain });
  if (error) back(PAGE, { error: errorMessage(error) });
  done(`${domain} 을(를) 추가했어요`);
}

export async function removeSite(form: FormData) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from('sites').delete().eq('id', str(form, 'id'));
  if (error) back(PAGE, { error: errorMessage(error) });
  done('홈페이지를 뺐어요');
}

export async function addInquiryType(form: FormData) {
  const { supabase, workspace } = await requireAdmin();
  const name = str(form, 'name');
  if (!name) back(PAGE, { error: '상담 유형 이름을 적어 주세요' });
  const { count } = await supabase.from('inquiry_types').select('id', { count: 'exact', head: true });
  const { error } = await supabase
    .from('inquiry_types')
    .insert({ workspace_id: workspace.id, name, position: (count ?? 0) + 1 });
  if (error) back(PAGE, { error: errorMessage(error) });
  done(`상담 유형 ‘${name}’ 을(를) 추가했어요`);
}

export async function removeInquiryType(form: FormData) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from('inquiry_types').delete().eq('id', str(form, 'id'));
  if (error) back(PAGE, { error: errorMessage(error) });
  done('상담 유형을 지웠어요');
}

export async function inviteMember(form: FormData) {
  const { supabase, workspace } = await requireAdmin();
  const email = str(form, 'email').toLowerCase();
  const role = str(form, 'role') === 'admin' ? 'admin' : 'staff';
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) back(PAGE, { error: '이메일을 확인해 주세요' });
  const { error } = await supabase.from('invitations').insert({ workspace_id: workspace.id, email, role });
  if (error) back(PAGE, { error: errorMessage(error) });
  done(`${email} 초대 링크를 만들었어요. 아래에서 복사해 보내 주세요`);
}

export async function cancelInvite(form: FormData) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from('invitations').delete().eq('id', str(form, 'id'));
  if (error) back(PAGE, { error: errorMessage(error) });
  done('초대를 취소했어요');
}

export async function removeMember(form: FormData) {
  const { supabase, member } = await requireAdmin();
  const id = str(form, 'id');
  if (id === member.id) back(PAGE, { error: '자기 자신은 삭제할 수 없어요' });
  const { error, count } = await supabase.from('users').delete({ count: 'exact' }).eq('id', id);
  if (error || !count) back(PAGE, { error: error ? errorMessage(error) : '삭제하지 못했어요' });
  done('사용자를 삭제했어요');
}

export async function updateCoupons(form: FormData) {
  const { supabase } = await requireAdmin();
  const codes = [...new Set(str(form, 'coupon_codes').split(',').map((c) => c.trim()).filter(Boolean))].slice(0, 20);
  const { error } = await supabase.from('channels').update({ coupon_codes: codes }).eq('id', str(form, 'id'));
  if (error) back(PAGE, { error: errorMessage(error) });
  done('쿠폰·암호 문구를 저장했어요');
}
