-- 3단계 문의함: 상태·금액·실패 사유, 직접 등록(유입경로 필수·쿠폰 문구), 출처 수정, 변경 기록.
-- 화면이 쓰는 읽기·쓰기는 아래 함수로 모았다. 직접 등록 말고는 모두 security invoker 라서
-- 부르는 사람의 권한과 행 단위 보안이 그대로 적용된다.

-- ─── 채널 쿠폰·암호 문구 ─────────────────────────────────────

alter table public.channels add column coupon_codes text[] not null default '{}';
grant insert (coupon_codes), update (coupon_codes) on public.channels to authenticated;

-- ─── 문의 수정 규칙 ─────────────────────────────────────────

alter table public.leads add constraint leads_fail_reason_check
  check (fail_reason in ('가격', '연락 안 됨', '다른 곳 선택', '기타'));

grant update (status, contract_amount, fail_reason, channel_id, asked_channel_id,
  name_enc, name_hash, phone_enc, phone_hash, phone_masked, inquiry_type) on public.leads to authenticated;
create policy "사업장 사용자가 문의 수정" on public.leads for update to authenticated
  using (workspace_id = public.current_workspace_id())
  with check (workspace_id = public.current_workspace_id());

create function public.leads_before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  if new.status = 'contracted' then
    if new.contract_amount is null then
      raise exception '계약 금액을 입력해 주세요' using errcode = '23502';
    end if;
  else
    new.contract_amount := null;
  end if;
  if new.status <> 'failed' then
    new.fail_reason := null;
  end if;

  if new.channel_id is distinct from old.channel_id then
    if new.channel_id is not null and not exists (
      select 1 from public.channels where id = new.channel_id and workspace_id = new.workspace_id) then
      raise exception '이 사업장의 채널이 아니에요' using errcode = '42501';
    end if;
    -- 사람이 출처를 바꾸면 '직접 선택'. 원래 값은 변경 기록에 남는다.
    new.attribution := 'manual';
  end if;
  if new.asked_channel_id is distinct from old.asked_channel_id and new.asked_channel_id is not null and not exists (
    select 1 from public.channels where id = new.asked_channel_id and workspace_id = new.workspace_id) then
    raise exception '이 사업장의 채널이 아니에요' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger leads_before_update before update on public.leads
  for each row execute function public.leads_before_update();

-- ─── 변경 기록 ───────────────────────────────────────────────

create table public.lead_events (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,  -- 같은 순간에 남은 기록의 순서
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  user_id uuid references public.users (id) on delete set null,
  field text not null,   -- created, status, contract_amount, fail_reason, channel, attribution, asked_channel, name, phone, inquiry_type
  old_value text,
  new_value text,
  created_at timestamptz not null default now()
);
create index lead_events_lead_idx on public.lead_events (lead_id, seq);

alter table public.lead_events enable row level security;
revoke all on public.lead_events from anon, authenticated;
grant select on public.lead_events to authenticated;
create policy "변경 기록 읽기" on public.lead_events for select to authenticated
  using (workspace_id = public.current_workspace_id());

-- invoker 라서 사용자는 자기 사업장 채널 이름만 얻는다 (definer 트리거 안에서는 모두 보임)
create function public.channel_name(p_id uuid) returns text
language sql stable set search_path = '' as $$
  select name from public.channels where id = p_id
$$;

-- 변경 기록은 사용자가 직접 쓸 수 없고 이 트리거만 남긴다
create function public.leads_log_changes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
begin
  insert into public.lead_events (workspace_id, lead_id, user_id, field, old_value, new_value)
  select new.workspace_id, new.id, v_user, c.field, c.old_value, c.new_value
  from (values
    ('status', old.status, new.status, old.status is distinct from new.status),
    ('contract_amount', old.contract_amount::text, new.contract_amount::text, old.contract_amount is distinct from new.contract_amount),
    ('fail_reason', old.fail_reason, new.fail_reason, old.fail_reason is distinct from new.fail_reason),
    ('channel', public.channel_name(old.channel_id), public.channel_name(new.channel_id), old.channel_id is distinct from new.channel_id),
    ('attribution', old.attribution, new.attribution, old.attribution is distinct from new.attribution),
    ('asked_channel', public.channel_name(old.asked_channel_id), public.channel_name(new.asked_channel_id), old.asked_channel_id is distinct from new.asked_channel_id),
    -- 이름·연락처는 값을 남기지 않는다 (연락처는 가린 번호만)
    ('name', null, null, old.name_enc is distinct from new.name_enc),
    ('phone', old.phone_masked, new.phone_masked, old.phone_enc is distinct from new.phone_enc),
    ('inquiry_type', old.inquiry_type, new.inquiry_type, old.inquiry_type is distinct from new.inquiry_type)
  ) as c (field, old_value, new_value, changed)
  where c.changed;
  return null;
end $$;

create trigger leads_log_changes after update on public.leads
  for each row execute function public.leads_log_changes();

-- ─── 읽기 함수 ───────────────────────────────────────────────

-- 로그인한 사용자와 사업장
create function public.my_context() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'member', jsonb_build_object('id', u.id, 'email', u.email, 'name', u.name, 'role', u.role),
    'workspace', to_jsonb(w))
  from public.users u join public.workspaces w on w.id = u.workspace_id
  where u.id = auth.uid()
$$;

-- 문의 등록·수정 화면의 선택지
create function public.inbox_options() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'channels', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'kind', c.kind, 'code', c.code, 'hidden', c.hidden, 'coupon_codes', c.coupon_codes)
        order by c.position, c.name) from public.channels c), '[]'),
    'inquiry_types', coalesce((select jsonb_agg(t.name order by t.position) from public.inquiry_types t), '[]'))
$$;

create function public.lead_json(l public.leads) returns jsonb
language sql stable set search_path = '' as $$
  select to_jsonb(l) - 'first_touch' - 'last_touch' - 'phone_hash' - 'name_hash' || jsonb_build_object(
    'channel_name', public.channel_name(l.channel_id),
    'channel_code', (select code from public.channels where id = l.channel_id),
    'asked_channel_name', public.channel_name(l.asked_channel_id),
    'touches', (select count(*) from public.lead_touches t where t.lead_id = l.id),
    'last_touch_at', (select max(t.created_at) from public.lead_touches t where t.lead_id = l.id))
$$;

-- 문의 목록. p_channel: 채널 id, 또는 'none'(출처 미확인)
-- 이름·연락처는 암호화되어 있어 검색은 정확히 같은 이름(p_name_hash), 전체 번호(p_phone_hash), 뒷자리 4개(p_last4)로 한다.
create function public.inbox_list(
  p_status text default null,
  p_channel text default null,
  p_name_hash text default null,
  p_phone_hash text default null,
  p_last4 text default null,
  p_limit int default 30,
  p_offset int default 0
) returns jsonb
language sql stable set search_path = '' as $$
  with filtered as (
    select l.* from public.leads l
    where (p_status is null or l.status = p_status)
      and (p_channel is null
        or (p_channel = 'none' and l.channel_id is null)
        or (p_channel <> 'none' and l.channel_id::text = p_channel))
      and (p_name_hash is null or l.name_hash = p_name_hash)
      and (p_phone_hash is null or l.phone_hash = p_phone_hash)
      and (p_last4 is null or l.phone_masked like '%-' || p_last4)
  ), page as (
    select * from filtered order by created_at desc, id limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'items', coalesce((select jsonb_agg(public.lead_json(p) order by p.created_at desc, p.id) from page p), '[]'))
$$;

-- 문의함 탭 숫자 배지
create function public.inbox_new_count() returns int
language sql stable set search_path = '' as $$
  select count(*)::int from public.leads where status = 'new'
$$;

create function public.lead_detail(p_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select public.lead_json(l) || jsonb_build_object(
    'first_touch', l.first_touch,
    'last_touch', l.last_touch,
    'touch_list', coalesce((select jsonb_agg(jsonb_build_object(
        'method', t.method, 'channel_name', public.channel_name(t.channel_id), 'evidence', t.evidence, 'created_at', t.created_at)
        order by t.created_at) from public.lead_touches t where t.lead_id = l.id), '[]'),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
        'field', e.field, 'old_value', e.old_value, 'new_value', e.new_value, 'created_at', e.created_at,
        'user_name', coalesce(nullif(u.name, ''), u.email))
        order by e.seq) from public.lead_events e left join public.users u on u.id = e.user_id
        where e.lead_id = l.id), '[]'))
  from public.leads l where l.id = p_id
$$;

-- ─── 쓰기 함수 ───────────────────────────────────────────────

create function public.update_lead_status(p_id uuid, p_status text, p_amount bigint default null, p_fail_reason text default null)
returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_row public.leads;
begin
  update public.leads set status = p_status, contract_amount = p_amount, fail_reason = p_fail_reason
  where id = p_id returning * into v_row;
  if not found then
    raise exception '문의를 찾을 수 없어요' using errcode = 'P0002';
  end if;
  return public.lead_json(v_row);
end $$;

create function public.update_lead_channel(p_id uuid, p_channel_id uuid) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_row public.leads;
begin
  update public.leads set channel_id = p_channel_id where id = p_id returning * into v_row;
  if not found then
    raise exception '문의를 찾을 수 없어요' using errcode = 'P0002';
  end if;
  return public.lead_json(v_row);
end $$;

-- 자동 판별된 문의에 고객 응답을 추가로 남긴다. 출처는 바꾸지 않는다.
create function public.update_lead_asked(p_id uuid, p_channel_id uuid) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_row public.leads;
begin
  update public.leads set asked_channel_id = p_channel_id where id = p_id returning * into v_row;
  if not found then
    raise exception '문의를 찾을 수 없어요' using errcode = 'P0002';
  end if;
  return public.lead_json(v_row);
end $$;

-- 이름·연락처는 서버가 암호화한 값으로 받는다
create function public.update_lead_contact(
  p_id uuid, p_name_enc text, p_name_hash text, p_phone_enc text, p_phone_hash text, p_phone_masked text, p_inquiry_type text
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_row public.leads;
begin
  update public.leads set
    name_enc = p_name_enc, name_hash = p_name_hash,
    phone_enc = p_phone_enc, phone_hash = p_phone_hash, phone_masked = p_phone_masked,
    inquiry_type = nullif(btrim(p_inquiry_type), '')
  where id = p_id returning * into v_row;
  if not found then
    raise exception '문의를 찾을 수 없어요' using errcode = 'P0002';
  end if;
  return public.lead_json(v_row);
exception when unique_violation then
  raise exception '같은 연락처의 문의가 이미 있어요' using errcode = '23505';
end $$;

create function public.delete_lead(p_id uuid) returns boolean
language plpgsql set search_path = '' as $$
begin
  delete from public.leads where id = p_id;
  return found;
end $$;

-- 전화·방문·소개 문의 직접 등록. ‘어떻게 알고 오셨어요?’ 채널은 필수, 쿠폰 문구가 채널에 등록돼 있으면 그 채널.
-- 같은 연락처가 있으면 새 문의 대신 다시 연락으로 기록한다 (그래서 lead_touches 를 쓸 수 있는 definer).
create function public.create_manual_lead(
  p_method text,
  p_channel_id uuid,
  p_coupon text default null,
  p_name_enc text default null,
  p_name_hash text default null,
  p_phone_enc text default null,
  p_phone_hash text default null,
  p_phone_masked text default null,
  p_inquiry_type text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ws uuid := public.current_workspace_id();
  v_coupon text := nullif(btrim(p_coupon), '');
  v_channel uuid;
  v_attr text;
  v_evidence text;
  v_lead uuid;
begin
  if v_ws is null then
    raise exception '로그인이 필요해요' using errcode = '28000';
  end if;
  if p_method not in ('call', 'walkin', 'etc') then
    raise exception '문의 방식을 골라 주세요' using errcode = '22023';
  end if;

  if v_coupon is not null then
    select c.id into v_channel from public.channels c
    where c.workspace_id = v_ws
      and exists (select 1 from unnest(c.coupon_codes) code where lower(btrim(code)) = lower(v_coupon))
    order by c.position limit 1;
  end if;
  if v_channel is not null then
    v_attr := 'coupon';
    v_evidence := '쿠폰 문구 ' || left(v_coupon, 50);
  else
    if p_channel_id is null then
      raise exception '어떻게 알고 오셨는지 골라 주세요' using errcode = '22023';
    end if;
    select id into v_channel from public.channels where id = p_channel_id and workspace_id = v_ws;
    if v_channel is null then
      raise exception '이 사업장의 채널이 아니에요' using errcode = '42501';
    end if;
    v_attr := 'asked';
    v_evidence := '고객 응답';
  end if;

  if p_phone_hash is not null then
    select id into v_lead from public.leads where workspace_id = v_ws and phone_hash = p_phone_hash;
  end if;
  if v_lead is null then
    insert into public.leads (
      workspace_id, name_enc, name_hash, phone_enc, phone_hash, phone_masked, inquiry_type, method,
      channel_id, asked_channel_id, coupon_code, attribution, evidence
    ) values (
      v_ws, p_name_enc, p_name_hash, p_phone_enc, p_phone_hash, p_phone_masked, nullif(btrim(p_inquiry_type), ''), p_method,
      v_channel, case when v_attr = 'asked' then v_channel end, left(v_coupon, 50), v_attr, v_evidence
    )
    on conflict (workspace_id, phone_hash) where phone_hash is not null do nothing
    returning id into v_lead;
    if v_lead is not null then
      insert into public.lead_events (workspace_id, lead_id, user_id, field, new_value)
      values (v_ws, v_lead, auth.uid(), 'created', p_method);
      return jsonb_build_object('lead_id', v_lead, 'merged', false);
    end if;
    select id into v_lead from public.leads where workspace_id = v_ws and phone_hash = p_phone_hash;
  end if;

  insert into public.lead_touches (workspace_id, lead_id, method, channel_id, evidence)
  values (v_ws, v_lead, p_method, v_channel, v_evidence);
  return jsonb_build_object('lead_id', v_lead, 'merged', true);
end $$;

-- ─── 실행 권한 ───────────────────────────────────────────────

revoke execute on function public.leads_before_update(), public.leads_log_changes(), public.channel_name(uuid),
  public.my_context(), public.inbox_options(), public.lead_json(public.leads),
  public.inbox_list(text, text, text, text, text, int, int), public.inbox_new_count(), public.lead_detail(uuid),
  public.update_lead_status(uuid, text, bigint, text), public.update_lead_channel(uuid, uuid),
  public.update_lead_asked(uuid, uuid), public.update_lead_contact(uuid, text, text, text, text, text, text),
  public.delete_lead(uuid), public.create_manual_lead(text, uuid, text, text, text, text, text, text, text)
  from public, anon;
grant execute on function public.channel_name(uuid),
  public.my_context(), public.inbox_options(), public.lead_json(public.leads),
  public.inbox_list(text, text, text, text, text, int, int), public.inbox_new_count(), public.lead_detail(uuid),
  public.update_lead_status(uuid, text, bigint, text), public.update_lead_channel(uuid, uuid),
  public.update_lead_asked(uuid, uuid), public.update_lead_contact(uuid, text, text, text, text, text, text),
  public.delete_lead(uuid), public.create_manual_lead(text, uuid, text, text, text, text, text, text, text)
  to authenticated;
