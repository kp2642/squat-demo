import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const next = request.nextUrl.searchParams.get('next');
  const url = request.nextUrl.clone();
  url.pathname = next?.startsWith('/invite/') ? next : '/login';
  url.search = '';
  return NextResponse.redirect(url, { status: 303 });
}
