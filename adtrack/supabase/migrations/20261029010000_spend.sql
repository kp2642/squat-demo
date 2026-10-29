-- 4단계 광고비: 채널·월별 광고비, 네이버 키워드별 광고비, 채널 관리.
-- 광고비는 관리자만 보고 고친다 (직원은 성과·광고비 화면을 보지 못함).
-- 화면이 쓰는 읽기·쓰기는 아래 security invoker 함수로 모았다.

create table public.ad_spend (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  month date not null check (extract(day from month) = 1),   -- 그 달 1일
  amount bigint not null check (amount >= 0),
  updated_at timestamptz not null default now(),
  unique (workspace_id, channel_id, month)
);

create table public.keyword_spend (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  keyword text not null check (char_length(keyword) between 1 and 100),
  amount bigint not null check (amount >= 0),
  clicks int check (clicks >= 0),
  impressions bigint check (impressions >= 0),
  updated_at timestamptz not null default now(),
  unique (workspace_id, month, keyword)
);

alter table public.ad_spend enable row level security;
alter table public.keyword_spend enable row level security;
revoke all on public.ad_spend, public.keyword_spend from anon, authenticated;
grant select, insert, update, delete on public.ad_spend, public.keyword_spend to authenticated;

create policy "관리자만 광고비" on public.ad_spend for all to authenticated
  using (workspace_id = public.current_workspace_id() and public.is_workspace_admin())
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_admin());
create policy "관리자만 키워드 광고비" on public.keyword_spend for all to authenticated
  using (workspace_id = public.current_workspace_id() and public.is_workspace_admin())
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_admin());

-- 광고비의 채널은 같은 사업장 채널이어야 한다
create function public.ad_spend_check_channel() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.channels where id = new.channel_id and workspace_id = new.workspace_id) then
    raise exception '이 사업장의 채널이 아니에요' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger ad_spend_check_channel before insert or update on public.ad_spend
  for each row execute function public.ad_spend_check_channel();

create function public.require_admin() returns uuid
language plpgsql stable set search_path = '' as $$
begin
  if not public.is_workspace_admin() then
    raise exception '관리자만 할 수 있어요' using errcode = '42501';
  end if;
  return public.current_workspace_id();
end $$;

-- ─── 읽기 ────────────────────────────────────────────────────

-- 한 달의 광고비 화면. 지난 달 금액도 함께 (복사 버튼 안내용)
create function public.spend_month(p_month date) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_ws uuid := public.require_admin();
  v_month date := date_trunc('month', p_month)::date;
  v_prev date := (date_trunc('month', p_month) - interval '1 month')::date;
begin
  return jsonb_build_object(
    'month', v_month,
    'channels', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'kind', c.kind, 'code', c.code, 'hidden', c.hidden, 'utm_sources', c.utm_sources,
        'amount', cur.amount, 'prev_amount', prev.amount) order by c.hidden, c.position, c.name)
      from public.channels c
      left join public.ad_spend cur on cur.channel_id = c.id and cur.month = v_month
      left join public.ad_spend prev on prev.channel_id = c.id and prev.month = v_prev
      where c.workspace_id = v_ws), '[]'),
    'keywords', coalesce((
      select jsonb_agg(jsonb_build_object('keyword', k.keyword, 'amount', k.amount, 'clicks', k.clicks, 'impressions', k.impressions)
        order by k.amount desc, k.keyword)
      from public.keyword_spend k where k.month = v_month), '[]'),
    'keyword_total', (select coalesce(sum(amount), 0) from public.keyword_spend where month = v_month),
    'prev_total', (select coalesce(sum(amount), 0) from public.ad_spend where month = v_prev));
end $$;

-- ─── 쓰기 ────────────────────────────────────────────────────

-- p_items: [{channel_id, amount}] — amount 가 null 이면 그 달 금액을 지운다
create function public.save_ad_spend(p_month date, p_items jsonb) returns int
language plpgsql set search_path = '' as $$
declare
  v_ws uuid := public.require_admin();
  v_month date := date_trunc('month', p_month)::date;
  v_item jsonb;
  v_count int := 0;
begin
  for v_item in select * from jsonb_array_elements(p_items) loop
    if v_item ->> 'amount' is null then
      delete from public.ad_spend where channel_id = (v_item ->> 'channel_id')::uuid and month = v_month;
    else
      insert into public.ad_spend (workspace_id, channel_id, month, amount)
      values (v_ws, (v_item ->> 'channel_id')::uuid, v_month, (v_item ->> 'amount')::bigint)
      on conflict (workspace_id, channel_id, month) do update set amount = excluded.amount;
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end $$;

-- 지난 달 금액을 이번 달로. 이번 달에 이미 넣은 채널은 덮어쓰지 않는다.
create function public.copy_prev_month_spend(p_month date) returns int
language plpgsql set search_path = '' as $$
declare
  v_ws uuid := public.require_admin();
  v_month date := date_trunc('month', p_month)::date;
  v_count int;
begin
  insert into public.ad_spend (workspace_id, channel_id, month, amount)
  select v_ws, prev.channel_id, v_month, prev.amount
  from public.ad_spend prev
  join public.channels c on c.id = prev.channel_id and not c.hidden
  where prev.month = (v_month - interval '1 month')::date
  on conflict (workspace_id, channel_id, month) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- 네이버 키워드 보고서 올리기: 그 달 키워드 광고비를 파일 내용으로 바꾼다.
-- p_rows: [{keyword, amount, clicks, impressions}] (같은 키워드는 서버에서 이미 합쳤음)
-- p_set_channel: 네이버 검색광고 채널의 그 달 광고비도 키워드 합계로 맞출지
create function public.import_keyword_spend(p_month date, p_rows jsonb, p_set_channel boolean default false) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_ws uuid := public.require_admin();
  v_month date := date_trunc('month', p_month)::date;
  v_count int;
  v_total bigint;
  v_channel uuid;
begin
  delete from public.keyword_spend where month = v_month;
  insert into public.keyword_spend (workspace_id, month, keyword, amount, clicks, impressions)
  select v_ws, v_month, btrim(r ->> 'keyword'), (r ->> 'amount')::bigint, (r ->> 'clicks')::int, (r ->> 'impressions')::bigint
  from jsonb_array_elements(p_rows) r;
  get diagnostics v_count = row_count;
  select coalesce(sum(amount), 0) into v_total from public.keyword_spend where month = v_month;

  if p_set_channel then
    select id into v_channel from public.channels where workspace_id = v_ws and code = 'naver_sa';
    if v_channel is not null then
      insert into public.ad_spend (workspace_id, channel_id, month, amount) values (v_ws, v_channel, v_month, v_total)
      on conflict (workspace_id, channel_id, month) do update set amount = excluded.amount;
    end if;
  end if;
  return jsonb_build_object('count', v_count, 'total', v_total);
end $$;

create function public.save_keyword_spend(p_month date, p_keyword text, p_amount bigint, p_clicks int default null) returns void
language plpgsql set search_path = '' as $$
declare
  v_ws uuid := public.require_admin();
begin
  insert into public.keyword_spend (workspace_id, month, keyword, amount, clicks)
  values (v_ws, date_trunc('month', p_month)::date, btrim(p_keyword), p_amount, p_clicks)
  on conflict (workspace_id, month, keyword) do update set amount = excluded.amount, clicks = excluded.clicks, updated_at = now();
end $$;

create function public.delete_keyword_spend(p_month date, p_keyword text default null) returns int
language plpgsql set search_path = '' as $$
declare
  v_count int;
begin
  perform public.require_admin();
  delete from public.keyword_spend
  where month = date_trunc('month', p_month)::date and (p_keyword is null or keyword = p_keyword);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ─── 채널 관리 ───────────────────────────────────────────────

-- utm_source 매핑 값: 소문자·공백 제거·중복 제거, 입력한 순서 유지
create function public.clean_utm_sources(p_values text[]) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(v order by o), '{}') from (
    select lower(btrim(s)) as v, min(o) as o
    from unnest(p_values) with ordinality as t (s, o)
    where btrim(s) <> ''
    group by 1) x
$$;

create function public.add_channel(p_name text, p_kind text, p_utm_sources text[] default '{}') returns uuid
language plpgsql set search_path = '' as $$
declare
  v_ws uuid := public.require_admin();
  v_id uuid;
begin
  insert into public.channels (workspace_id, name, kind, utm_sources, position)
  values (v_ws, btrim(p_name), p_kind,
    public.clean_utm_sources(p_utm_sources),
    (select coalesce(max(position), 0) + 1 from public.channels where workspace_id = v_ws))
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception '같은 이름의 채널이 이미 있어요' using errcode = '23505';
end $$;

create function public.update_channel(p_id uuid, p_name text, p_kind text, p_utm_sources text[], p_hidden boolean) returns void
language plpgsql set search_path = '' as $$
begin
  perform public.require_admin();
  update public.channels set
    name = btrim(p_name), kind = p_kind, hidden = p_hidden,
    utm_sources = public.clean_utm_sources(p_utm_sources)
  where id = p_id;
  if not found then
    raise exception '채널을 찾을 수 없어요' using errcode = 'P0002';
  end if;
exception when unique_violation then
  raise exception '같은 이름의 채널이 이미 있어요' using errcode = '23505';
end $$;

revoke execute on function public.ad_spend_check_channel(), public.require_admin(), public.spend_month(date),
  public.save_ad_spend(date, jsonb), public.copy_prev_month_spend(date),
  public.import_keyword_spend(date, jsonb, boolean), public.save_keyword_spend(date, text, bigint, int),
  public.delete_keyword_spend(date, text), public.add_channel(text, text, text[]),
  public.update_channel(uuid, text, text, text[], boolean), public.clean_utm_sources(text[])
  from public, anon;
grant execute on function public.require_admin(), public.spend_month(date),
  public.save_ad_spend(date, jsonb), public.copy_prev_month_spend(date),
  public.import_keyword_spend(date, jsonb, boolean), public.save_keyword_spend(date, text, bigint, int),
  public.delete_keyword_spend(date, text), public.add_channel(text, text, text[]),
  public.update_channel(uuid, text, text, text[], boolean), public.clean_utm_sources(text[])
  to authenticated;
