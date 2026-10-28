'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { back, errorMessage, str } from '@/lib/form';
import { isValidDomain, parseDomains } from '@/lib/domain';

export async function createWorkspace(form: FormData) {
  const name = str(form, 'workspace_name');
  if (!name) back('/onboarding', { error: '사업장 이름을 적어 주세요' });
  const domains = parseDomains(str(form, 'domains'));
  const bad = domains.find((d) => !isValidDomain(d));
  if (bad) back('/onboarding', { error: `홈페이지 주소를 확인해 주세요: ${bad}` });

  const supabase = await createClient();
  const { error } = await supabase.rpc('create_workspace', {
    p_name: name,
    p_industry: str(form, 'industry'),
    p_domains: domains,
    p_user_name: str(form, 'name'),
  });
  if (error) back('/onboarding', { error: errorMessage(error) });
  redirect('/app/setup');
}
