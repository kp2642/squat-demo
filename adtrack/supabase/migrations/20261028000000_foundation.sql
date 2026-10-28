-- 1단계 기반: 사업장, 사용자, 홈페이지, 상담 유형, 채널, 직원 초대, 업종 프리셋.
-- 모든 사업장 데이터는 workspace_id 로 묶이고, 행 단위 보안(RLS)으로 자기 사업장만 보이게 한다.
-- 사업장·사용자 생성과 초대 수락은 아래 security definer 함수로만 할 수 있다.

-- ─── 업종 프리셋 ─────────────────────────────────────────────

create table public.industry_presets (
  key text primary key,
  name text not null,
  contract_term text not null,          -- 계약 용어 (수임·결제·등록·계약)
  avg_contract_amount bigint not null,  -- 원
  inquiry_types text[] not null,
  position int not null
);

insert into public.industry_presets (key, name, contract_term, avg_contract_amount, inquiry_types, position) values
  ('legal',    '법률',       '수임', 3000000,  array['이혼','형사','민사','상속','기업 자문','기타'], 1),
  ('clinic',   '병원·의원',  '결제', 500000,   array['초진 상담','시술 상담','수술 상담','재진','기타'], 2),
  ('tax',      '세무·회계',  '계약', 1200000,  array['기장','신고 대행','상속·증여','세무조사 대응','기타'], 3),
  ('academy',  '학원·교육',  '등록', 600000,   array['입학 상담','레벨 테스트','체험 수업','기타'], 4),
  ('interior', '인테리어',   '계약', 20000000, array['주거 전체','부분 시공','상가','기타'], 5),
  ('other',    '기타 상담형', '계약', 1000000,  array['상담','기타'], 6);

-- ─── 테이블 ─────────────────────────────────────────────────

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  industry text not null references public.industry_presets (key),
  contract_term text not null check (char_length(btrim(contract_term)) between 1 and 20),
  avg_contract_amount bigint not null check (avg_contract_amount >= 0),
  roas_high int not null default 500,   -- 이상이면 '확대 검토'
  roas_low int not null default 200,    -- 미만이면 '점검 필요'
  -- 추적 코드에 들어가는 공개 키. 비밀이 아니고, 등록된 도메인과 함께 검사한다.
  tracking_key text not null unique
    default 'tk_' || replace(gen_random_uuid()::text, '-', ''),
  thank_you_url text,                   -- 문의 완료 페이지 주소 (폼을 못 찾는 사이트용)
  created_at timestamptz not null default now(),
  check (roas_low >= 0 and roas_low < roas_high)
);

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null,
  name text not null default '' check (char_length(name) <= 50),
  role text not null check (role in ('admin', 'staff')),
  created_at timestamptz not null default now()
);
create index users_workspace_id_idx on public.users (workspace_id);

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  domain text not null check (domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  verified_at timestamptz,              -- 추적 코드가 처음 신호를 보낸 시각 (2단계에서 채움)
  created_at timestamptz not null default now(),
  unique (workspace_id, domain)
);

create table public.inquiry_types (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 30),
  position int not null default 0,
  unique (workspace_id, name)
);

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 30),
  kind text not null check (kind in ('paid', 'free')),
  -- 출처 판별 규칙이 찾는 기본 채널 표시. 직접 추가한 채널은 null.
  code text check (code in ('naver_sa', 'google_ads', 'meta_ads', 'kakao_ads', 'blog', 'organic', 'direct', 'naver_place', 'referral')),
  utm_sources text[] not null default '{}',
  hidden boolean not null default false,
  position int not null default 0,
  unique (workspace_id, name),
  unique (workspace_id, code)
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email like '%_@_%'),
  role text not null default 'staff' check (role in ('admin', 'staff')),
  token text not null unique
    default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  invited_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null
);
create index invitations_workspace_id_idx on public.invitations (workspace_id);

-- ─── 권한 확인 함수 ──────────────────────────────────────────
-- security definer 라서 users 테이블의 RLS 를 거치지 않는다 (정책 안에서 써도 재귀가 생기지 않음).

create function public.current_workspace_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select workspace_id from public.users where id = auth.uid()
$$;

create function public.is_workspace_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.users where id = auth.uid() and role = 'admin')
$$;

-- 'https://www.Example.com/contact?a=1' → 'example.com'
create function public.normalize_domain(p_url text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(
    split_part(split_part(split_part(regexp_replace(lower(btrim(p_url)), '^[a-z]+://', ''), '/', 1), '?', 1), ':', 1),
    '^www\.', '')
$$;

-- ─── 행 단위 보안 ────────────────────────────────────────────

alter table public.industry_presets enable row level security;
alter table public.workspaces enable row level security;
alter table public.users enable row level security;
alter table public.sites enable row level security;
alter table public.inquiry_types enable row level security;
alter table public.channels enable row level security;
alter table public.invitations enable row level security;

-- 권한은 기본 grant 에 기대지 않고 여기서 정한다. 수정 가능한 열도 제한한다.
revoke all on public.industry_presets, public.workspaces, public.users, public.sites,
  public.inquiry_types, public.channels, public.invitations from anon, authenticated;

grant select on public.industry_presets to anon, authenticated;
create policy "프리셋은 누구나 읽기" on public.industry_presets for select to anon, authenticated using (true);

grant select on public.workspaces to authenticated;
grant update (name, industry, contract_term, avg_contract_amount, roas_high, roas_low, thank_you_url)
  on public.workspaces to authenticated;
create policy "내 사업장 읽기" on public.workspaces for select to authenticated
  using (id = public.current_workspace_id());
create policy "관리자만 사업장 수정" on public.workspaces for update to authenticated
  using (id = public.current_workspace_id() and public.is_workspace_admin())
  with check (id = public.current_workspace_id());

grant select, delete on public.users to authenticated;
grant update (name) on public.users to authenticated;
create policy "같은 사업장 사용자 읽기" on public.users for select to authenticated
  using (workspace_id = public.current_workspace_id());
create policy "내 이름만 수정" on public.users for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy "관리자가 다른 사용자 삭제" on public.users for delete to authenticated
  using (workspace_id = public.current_workspace_id() and public.is_workspace_admin() and id <> auth.uid());

grant select, delete on public.sites to authenticated;
grant insert (workspace_id, domain), update (domain) on public.sites to authenticated;
create policy "사이트 읽기" on public.sites for select to authenticated
  using (workspace_id = public.current_workspace_id());
create policy "관리자만 사이트 추가" on public.sites for insert to authenticated
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_admin());
create policy "관리자만 사이트 수정" on public.sites for update to authenticated
  using (workspace_id = public.current_workspace_id() and public.is_workspace_admin())
  with check (workspace_id = public.current_workspace_id());
create policy "관리자만 사이트 삭제" on public.sites for delete to authenticated
  using (workspace_id = public.current_workspace_id() and public.is_workspace_admin());

grant select, delete on public.inquiry_types to authenticated;
grant insert (workspace_id, name, position), update (name, position) on public.inquiry_types to authenticated;
create policy "상담 유형 읽기" on public.inquiry_types for select to authenticated
  using (workspace_id = public.current_workspace_id());
create policy "관리자만 상담 유형 추가" on public.inquiry_types for insert to authenticated
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_admin());
create policy "관리자만 상담 유형 수정" on public.inquiry_types for update to authenticated
  using (workspace_id = public.current_workspace_id() and public.is_workspace_admin())
  with check (workspace_id = public.current_workspace_id());
create policy "관리자만 상담 유형 삭제" on public.inquiry_types for delete to authenticated
  using (workspace_id = public.current_workspace_id() and public.is_workspace_admin());

grant select, delete on public.channels to authenticated;
grant insert (workspace_id, name, kind, utm_sources, hidden, position),
  update (name, kind, utm_sources, hidden, position) on public.channels to authenticated;
create policy "채널 읽기" on public.channels for select to authenticated
  using (workspace_id = public.current_workspace_id());
create policy "관리자만 채널 추가" on public.channels for insert to authenticated
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_admin());
create policy "관리자만 채널 수정" on public.channels for update to authenticated
  using (workspace_id = public.current_workspace_id() and public.is_workspace_admin())
  with check (workspace_id = public.current_workspace_id());
-- 기본 채널(code 있음)은 출처 판별에 쓰이므로 지우지 않고 숨긴다.
create policy "관리자만 직접 추가한 채널 삭제" on public.channels for delete to authenticated
  using (workspace_id = public.current_workspace_id() and public.is_workspace_admin() and code is null);

grant select, delete on public.invitations to authenticated;
grant insert (workspace_id, email, role) on public.invitations to authenticated;
create policy "관리자만 초대 읽기" on public.invitations for select to authenticated
  using (workspace_id = public.current_workspace_id() and public.is_workspace_admin());
create policy "관리자만 초대" on public.invitations for insert to authenticated
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_admin());
create policy "관리자만 초대 취소" on public.invitations for delete to authenticated
  using (workspace_id = public.current_workspace_id() and public.is_workspace_admin());

-- 초대한 사람을 서버에서 채운다 (클라이언트가 다른 사람 이름으로 초대하지 못하게).
create function public.set_invited_by() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.invited_by := auth.uid();
  return new;
end $$;
create trigger invitations_set_invited_by before insert on public.invitations
  for each row execute function public.set_invited_by();

-- ─── RPC: 사업장 만들기 ──────────────────────────────────────

create function public.create_workspace(
  p_name text,
  p_industry text,
  p_domains text[] default '{}',
  p_user_name text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_preset public.industry_presets;
  v_ws uuid;
  v_domain text;
begin
  if v_uid is null then
    raise exception '로그인이 필요해요' using errcode = '28000';
  end if;
  if exists (select 1 from public.users where id = v_uid) then
    raise exception '이미 사업장에 속해 있어요' using errcode = '23505';
  end if;
  select email into v_email from auth.users where id = v_uid;
  select * into v_preset from public.industry_presets where key = p_industry;
  if not found then
    raise exception '알 수 없는 업종: %', p_industry using errcode = '22023';
  end if;

  insert into public.workspaces (name, industry, contract_term, avg_contract_amount)
  values (btrim(p_name), v_preset.key, v_preset.contract_term, v_preset.avg_contract_amount)
  returning id into v_ws;

  insert into public.users (id, workspace_id, email, name, role)
  values (v_uid, v_ws, coalesce(v_email, ''), btrim(coalesce(p_user_name, '')), 'admin');

  insert into public.inquiry_types (workspace_id, name, position)
  select v_ws, t.name, t.ord from unnest(v_preset.inquiry_types) with ordinality as t(name, ord);

  insert into public.channels (workspace_id, name, kind, code, utm_sources, position) values
    (v_ws, '네이버 검색광고', 'paid', 'naver_sa',   array['naver'], 1),
    (v_ws, '구글 광고',       'paid', 'google_ads', array['google'], 2),
    (v_ws, '메타 광고',       'paid', 'meta_ads',   array['meta','facebook','instagram','fb','ig'], 3),
    (v_ws, '카카오 광고',     'paid', 'kakao_ads',  array['kakao'], 4),
    (v_ws, '블로그·체험단',   'free', 'blog',       array['blog'], 5),
    (v_ws, '네이버 예약·톡톡', 'free', 'naver_place', '{}', 6),
    (v_ws, '자연 검색',       'free', 'organic',    '{}', 7),
    (v_ws, '지인 소개',       'free', 'referral',   '{}', 8),
    (v_ws, '직접 방문',       'free', 'direct',     '{}', 9);

  foreach v_domain in array coalesce(p_domains, '{}') loop
    v_domain := public.normalize_domain(v_domain);
    if v_domain <> '' then
      insert into public.sites (workspace_id, domain) values (v_ws, v_domain)
      on conflict (workspace_id, domain) do nothing;
    end if;
  end loop;

  return v_ws;
end $$;

-- ─── RPC: 초대 ──────────────────────────────────────────────

-- 초대 링크 화면에서 로그인 전에 보여줄 정보. 토큰을 아는 사람만 볼 수 있다.
create function public.get_invitation(p_token text)
returns table (workspace_name text, email text, role text, expired boolean, accepted boolean)
language sql stable security definer set search_path = '' as $$
  select w.name, i.email, i.role, i.expires_at < now(), i.accepted_at is not null
  from public.invitations i join public.workspaces w on w.id = i.workspace_id
  where i.token = p_token
$$;

create function public.accept_invitation(p_token text, p_user_name text default '')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_inv public.invitations;
begin
  if v_uid is null then
    raise exception '로그인이 필요해요' using errcode = '28000';
  end if;
  select * into v_inv from public.invitations where token = p_token for update;
  if not found then
    raise exception '초대를 찾을 수 없어요' using errcode = 'P0002';
  end if;
  if v_inv.accepted_at is not null then
    raise exception '이미 사용된 초대예요' using errcode = '22023';
  end if;
  if v_inv.expires_at < now() then
    raise exception '만료된 초대예요' using errcode = '22023';
  end if;
  select lower(email) into v_email from auth.users where id = v_uid;
  if v_email is distinct from v_inv.email then
    raise exception '초대받은 이메일(%)로 로그인해 주세요', v_inv.email using errcode = '42501';
  end if;
  if exists (select 1 from public.users where id = v_uid) then
    raise exception '이미 다른 사업장에 속해 있어요' using errcode = '23505';
  end if;

  insert into public.users (id, workspace_id, email, name, role)
  values (v_uid, v_inv.workspace_id, v_email, btrim(coalesce(p_user_name, '')), v_inv.role);
  update public.invitations set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;
  return v_inv.workspace_id;
end $$;

-- ─── 함수 실행 권한 ──────────────────────────────────────────

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.current_workspace_id(), public.is_workspace_admin(),
  public.normalize_domain(text), public.create_workspace(text, text, text[], text),
  public.accept_invitation(text, text) to authenticated;
grant execute on function public.get_invitation(text) to anon, authenticated;
