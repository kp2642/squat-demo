'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { back, errorMessage, str } from '@/lib/form';
import { isValidDomain, parseDomains } from '@/lib/domain';
import { siteOrigin } from '@/lib/origin';

export async function signup(form: FormData) {
  const email = str(form, 'email');
  const password = str(form, 'password');
  const draft = {
    name: str(form, 'name'),
    workspaceName: str(form, 'workspace_name'),
    industry: str(form, 'industry'),
    domains: str(form, 'domains'),
  };
  const retry = (error: string): never => back('/signup', { error, email, ...draft });

  if (password.length < 8) retry('비밀번호는 8자 이상으로 정해 주세요');
  if (!draft.workspaceName) retry('사업장 이름을 적어 주세요');
  const domains = parseDomains(draft.domains);
  const bad = domains.find((d) => !isValidDomain(d));
  if (bad) retry(`홈페이지 주소를 확인해 주세요: ${bad}`);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${await siteOrigin()}/auth/confirm?next=/onboarding`,
      // 메일 확인 후 사업장 만들기 화면에 다시 채워 넣을 값
      data: { name: draft.name, pending_workspace: draft },
    },
  });
  if (error) retry(errorMessage(error));

  // 메일 확인을 끈 프로젝트면 바로 세션이 생긴다
  if (data.session) {
    const { error: rpcError } = await supabase.rpc('create_workspace', {
      p_name: draft.workspaceName,
      p_industry: draft.industry,
      p_domains: domains,
      p_user_name: draft.name,
    });
    if (rpcError) back('/onboarding', { error: errorMessage(rpcError) });
    redirect('/app/setup');
  }
  back('/login', { notice: `${email} 로 보낸 확인 메일의 링크를 눌러 주세요. 그다음 사업장이 만들어져요.`, email });
}
