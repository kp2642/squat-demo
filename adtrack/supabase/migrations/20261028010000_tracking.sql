-- 2단계 추적: 문의(leads), 같은 연락처의 다시 연락(lead_touches), 광고 꼬리표가 있는 방문(visits),
-- 그리고 추적 코드가 부르는 수집 함수. 수집 함수는 서버(service_role)만 실행할 수 있다.
-- 출처 판별(어느 규칙에 걸렸는지)은 서버 코드(src/lib/attribution.ts)가 하고, 여기서는 그 결과를 채널 id 로 바꿔 저장한다.

-- ─── 테이블 ─────────────────────────────────────────────────

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  site_id uuid references public.sites (id) on delete set null,
  -- 이름·연락처는 서버에서 암호화한 값만 저장한다 (src/lib/crypto.ts)
  name_enc text,
  phone_enc text,
  phone_hash text,                      -- 같은 연락처 찾기용 (사업장별 HMAC)
  phone_masked text,                    -- 화면 표시용 '010-****-5678'
  inquiry_type text,                    -- 폼에서 받은 상담 유형 글자 그대로
  method text not null check (method in ('form', 'call', 'walkin', 'etc')),
  channel_id uuid references public.channels (id) on delete set null,
  keyword text,
  campaign text,
  ad_group text,
  ad_content text,
  attribution text not null check (attribution in ('auto', 'asked', 'manual', 'unknown')),
  asked_channel_id uuid references public.channels (id) on delete set null,
  coupon_code text,
  evidence text,                        -- 판별 근거 (예: n_keyword=이혼전문변호사)
  first_touch jsonb,
  last_touch jsonb,
  status text not null default 'new' check (status in ('new', 'consulting', 'contracted', 'failed')),
  contract_amount bigint check (contract_amount >= 0),
  fail_reason text,
  created_at timestamptz not null default now(),
  status_changed_at timestamptz
);
create index leads_workspace_created_idx on public.leads (workspace_id, created_at desc);
-- 같은 연락처 문의는 하나로 합친다. 동시에 두 번 들어와도 DB 가 막아 준다.
create unique index leads_workspace_phone_idx on public.leads (workspace_id, phone_hash) where phone_hash is not null;

create table public.lead_touches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  method text not null check (method in ('form', 'call', 'walkin', 'etc')),
  channel_id uuid references public.channels (id) on delete set null,
  evidence text,
  touch jsonb,
  created_at timestamptz not null default now()
);
create index lead_touches_lead_idx on public.lead_touches (lead_id);

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  visitor_id text not null check (char_length(visitor_id) <= 64),
  tags jsonb not null,
  referrer text,
  landing text,
  created_at timestamptz not null default now()
);
create index visits_workspace_created_idx on public.visits (workspace_id, created_at desc);

-- 스팸 방지용 짧은 기간 카운터
create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  hits int not null
);

-- ─── 행 단위 보안 ────────────────────────────────────────────
-- 문의를 고치는 화면은 3단계. 지금은 사업장 사용자가 읽기만, 관리자가 삭제만 할 수 있다.

alter table public.leads enable row level security;
alter table public.lead_touches enable row level security;
alter table public.visits enable row level security;
alter table public.rate_limits enable row level security;

revoke all on public.leads, public.lead_touches, public.visits, public.rate_limits from anon, authenticated;

grant select, delete on public.leads to authenticated;
create policy "문의 읽기" on public.leads for select to authenticated
  using (workspace_id = public.current_workspace_id());
create policy "관리자만 문의 삭제" on public.leads for delete to authenticated
  using (workspace_id = public.current_workspace_id() and public.is_workspace_admin());

grant select on public.lead_touches to authenticated;
create policy "다시 연락 기록 읽기" on public.lead_touches for select to authenticated
  using (workspace_id = public.current_workspace_id());

grant select on public.visits to authenticated;
create policy "관리자만 방문 기록 읽기" on public.visits for select to authenticated
  using (workspace_id = public.current_workspace_id() and public.is_workspace_admin());

-- rate_limits 는 정책이 없으므로 수집 함수 밖에서는 읽고 쓸 수 없다.

-- ─── 수집 함수 ───────────────────────────────────────────────

-- 추적 키와 요청한 홈페이지 주소가 등록된 사이트와 맞는지 확인. 하위 도메인(m.example.com)도 허용.
create function public.collect_site(p_tracking_key text, p_host text)
returns table (workspace_id uuid, site_id uuid)
language sql stable security definer set search_path = '' as $$
  select w.id, s.id
  from public.workspaces w
  join public.sites s on s.workspace_id = w.id
  where w.tracking_key = p_tracking_key
    and (public.normalize_domain(p_host) = s.domain or public.normalize_domain(p_host) like '%.' || s.domain)
  order by length(s.domain) desc
  limit 1
$$;

-- 기간(초) 안에 limit 번을 넘으면 false
create function public.rate_limit_hit(p_key text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_hits int;
begin
  insert into public.rate_limits as r (key, window_start, hits) values (p_key, now(), 1)
  on conflict (key) do update set
    hits = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
    window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning hits into v_hits;
  return v_hits <= p_limit;
end $$;

-- 추적 코드 파일에 넣을 사업장 설정
create function public.tracker_config(p_tracking_key text)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('thankYouUrl', w.thank_you_url)
  from public.workspaces w where w.tracking_key = p_tracking_key
$$;

-- 추적 코드가 처음 신호를 보내면 '설치 확인됨'
create function public.collect_hello(p_tracking_key text, p_host text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_site record;
begin
  select * into v_site from public.collect_site(p_tracking_key, p_host);
  if v_site.site_id is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown_site');
  end if;
  update public.sites set verified_at = now() where id = v_site.site_id and verified_at is null;
  return jsonb_build_object('ok', true);
end $$;

create function public.collect_visit(
  p_tracking_key text, p_host text, p_visitor_id text, p_tags jsonb, p_referrer text, p_landing text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_site record;
begin
  select * into v_site from public.collect_site(p_tracking_key, p_host);
  if v_site.site_id is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown_site');
  end if;
  if not public.rate_limit_hit('visit:' || v_site.site_id || ':' || p_visitor_id, 30, 600) then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;
  update public.sites set verified_at = now() where id = v_site.site_id and verified_at is null;
  insert into public.visits (workspace_id, site_id, visitor_id, tags, referrer, landing)
  values (v_site.workspace_id, v_site.site_id, left(p_visitor_id, 64), p_tags, left(p_referrer, 500), left(p_landing, 500));
  return jsonb_build_object('ok', true);
end $$;

-- 문의 한 건 저장. 같은 연락처가 있으면 새 문의 대신 다시 연락 기록을 남기고 출처는 첫 문의 것을 유지한다.
-- p_lead: name_enc, phone_enc, phone_hash, phone_masked, inquiry_type,
--         source{code, utm_source, keyword, campaign, ad_group, ad_content, evidence}, first_touch, last_touch
create function public.collect_lead(
  p_tracking_key text, p_host text, p_visitor_id text, p_ip_hash text, p_lead jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_site record;
  v_src jsonb := coalesce(p_lead -> 'source', '{}');
  v_channel uuid;
  v_lead uuid;
  v_type text;
begin
  select * into v_site from public.collect_site(p_tracking_key, p_host);
  if v_site.site_id is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown_site');
  end if;
  -- 같은 방문자 10분에 3건, 같은 IP 10분에 20건 (사무실은 IP 를 같이 쓰므로 넉넉하게)
  if not public.rate_limit_hit('lead:v:' || v_site.site_id || ':' || p_visitor_id, 3, 600)
     or not public.rate_limit_hit('lead:ip:' || v_site.site_id || ':' || p_ip_hash, 20, 600) then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;
  update public.sites set verified_at = now() where id = v_site.site_id and verified_at is null;

  if nullif(v_src ->> 'utm_source', '') is not null then
    select c.id into v_channel from public.channels c
    where c.workspace_id = v_site.workspace_id and lower(v_src ->> 'utm_source') = any (c.utm_sources)
    order by c.position limit 1;
  elsif nullif(v_src ->> 'code', '') is not null then
    select c.id into v_channel from public.channels c
    where c.workspace_id = v_site.workspace_id and c.code = v_src ->> 'code';
  end if;

  v_type := nullif(left(btrim(p_lead ->> 'inquiry_type'), 50), '');

  if nullif(p_lead ->> 'phone_hash', '') is not null then
    select id into v_lead from public.leads
    where workspace_id = v_site.workspace_id and phone_hash = p_lead ->> 'phone_hash';
  end if;

  if v_lead is null then
    insert into public.leads (
      workspace_id, site_id, name_enc, phone_enc, phone_hash, phone_masked, inquiry_type, method,
      channel_id, keyword, campaign, ad_group, ad_content, attribution, evidence, first_touch, last_touch
    ) values (
      v_site.workspace_id, v_site.site_id,
      nullif(p_lead ->> 'name_enc', ''), nullif(p_lead ->> 'phone_enc', ''),
      nullif(p_lead ->> 'phone_hash', ''), nullif(p_lead ->> 'phone_masked', ''),
      v_type, 'form', v_channel,
      left(v_src ->> 'keyword', 200), left(v_src ->> 'campaign', 200),
      left(v_src ->> 'ad_group', 200), left(v_src ->> 'ad_content', 200),
      case when v_channel is null then 'unknown' else 'auto' end,
      left(v_src ->> 'evidence', 500), p_lead -> 'first_touch', p_lead -> 'last_touch'
    )
    on conflict (workspace_id, phone_hash) where phone_hash is not null do nothing
    returning id into v_lead;

    if v_lead is not null then
      return jsonb_build_object('ok', true, 'lead_id', v_lead, 'merged', false);
    end if;
    -- 같은 연락처가 동시에 들어와 방금 다른 요청이 만들었다
    select id into v_lead from public.leads
    where workspace_id = v_site.workspace_id and phone_hash = p_lead ->> 'phone_hash';
  end if;

  insert into public.lead_touches (workspace_id, lead_id, method, channel_id, evidence, touch)
  values (v_site.workspace_id, v_lead, 'form', v_channel, left(v_src ->> 'evidence', 500), p_lead -> 'last_touch');
  return jsonb_build_object('ok', true, 'lead_id', v_lead, 'merged', true);
end $$;

revoke execute on function public.collect_site(text, text), public.rate_limit_hit(text, int, int),
  public.tracker_config(text), public.collect_hello(text, text),
  public.collect_visit(text, text, text, jsonb, text, text),
  public.collect_lead(text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.tracker_config(text), public.collect_hello(text, text),
  public.collect_visit(text, text, text, jsonb, text, text),
  public.collect_lead(text, text, text, text, jsonb)
  to service_role;
