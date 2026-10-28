'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { back, errorMessage, safeNext, str } from '@/lib/form';

export async function login(form: FormData) {
  const next = safeNext(str(form, 'next'));
  const email = str(form, 'email');
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password: str(form, 'password') });
  if (error) back('/login', { error: errorMessage(error), email, next });
  redirect(next);
}
