'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { back, errorMessage, str } from '@/lib/form';
import { siteOrigin } from '@/lib/origin';

export async function acceptInvite(form: FormData) {
  const token = str(form, 'token');
  const supabase = await createClient();
  const { error } = await supabase.rpc('accept_invitation', { p_token: token, p_user_name: str(form, 'name') });
  if (error) back(`/invite/${token}`, { error: errorMessage(error) });
  redirect('/app');
}

// 초대받은 이메일로 새로 가입. 메일 확인을 거쳐 다시 이 초대 화면으로 돌아온다.
export async function signupFromInvite(form: FormData) {
  const token = str(form, 'token');
  const name = str(form, 'name');
  const password = str(form, 'password');
  if (password.length < 8) back(`/invite/${token}`, { error: '비밀번호는 8자 이상으로 정해 주세요', name });

  const supabase = await createClient();
  const { data: invites } = await supabase.rpc('get_invitation', { p_token: token });
  const invite = invites?.[0];
  if (!invite) back(`/invite/${token}`, {});

  const { data, error } = await supabase.auth.signUp({
    email: invite.email,
    password,
    options: {
      emailRedirectTo: `${await siteOrigin()}/auth/confirm?next=/invite/${token}`,
      data: { name },
    },
  });
  if (error) back(`/invite/${token}`, { error: errorMessage(error), name });

  if (data.session) {
    const { error: rpcError } = await supabase.rpc('accept_invitation', { p_token: token, p_user_name: name });
    if (rpcError) back(`/invite/${token}`, { error: errorMessage(rpcError) });
    redirect('/app');
  }
  back(`/invite/${token}`, { notice: `${invite.email} 로 보낸 확인 메일의 링크를 누르면 가입이 끝나요.` });
}
