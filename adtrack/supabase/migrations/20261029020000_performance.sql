-- 5단계 성과 화면 집계. 비율·ROAS·판단 딱지·제안은 서버 코드(src/lib/performance.ts)가 계산한다.
-- 계산 규칙 (요구사항 문서 '계산 규칙'):
--   - 모든 지표는 선택한 기간에 '등록된 문의' 기준. 계약이 다음 달에 성사돼도 문의가 들어온 날의 성과.
--   - 기간은 한국 시간 날짜로 p_from ~ p_to (둘 다 포함).
--   - 광고비는 월 단위라 기간이 그 달의 일부면 '월 금액 × (기간에 든 일수 ÷ 그 달 일수)'. 채널별로 더한 뒤 원 단위 반올림.

create function public.norm_keyword(p text) returns text
language sql immutable set search_path = '' as $$
  select nullif(lower(regexp_replace(btrim(p), '\s+', '', 'g')), '')
$$;

create function public.performance(p_from date, p_to date) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_ws uuid := public.require_admin();
  v_from timestamptz := p_from::timestamp at time zone 'Asia/Seoul';
  v_to timestamptz := (p_to + 1)::timestamp at time zone 'Asia/Seoul';
  v_result jsonb;
begin
  if p_from is null or p_to is null or p_to < p_from then
    raise exception '기간을 확인해 주세요' using errcode = '22023';
  end if;
  if p_to - p_from > 366 then
    raise exception '기간은 1년까지 볼 수 있어요' using errcode = '22023';
  end if;

  with
  l as (
    select * from public.leads
    where workspace_id = v_ws and created_at >= v_from and created_at < v_to
  ),
  by_channel as (
    select channel_id,
      count(*) as leads,
      count(*) filter (where status = 'contracted') as contracts,
      coalesce(sum(contract_amount) filter (where status = 'contracted'), 0) as revenue
    from l group by channel_id
  ),
  -- 기간과 겹치는 달의 광고비를 겹친 일수만큼
  spend_parts as (
    select s.*, (s.month + interval '1 month' - interval '1 day')::date as month_end
    from public.ad_spend s
    where s.workspace_id = v_ws and s.month <= p_to and (s.month + interval '1 month')::date > p_from
  ),
  spend as (
    select channel_id,
      round(sum(amount::numeric * (least(p_to, month_end) - greatest(p_from, month) + 1) / extract(day from month_end)))::bigint as spend
    from spend_parts group by channel_id
  ),
  kw_spend as (
    select public.norm_keyword(k.keyword) as nk, min(k.keyword) as keyword,
      round(sum(k.amount::numeric
        * (least(p_to, (k.month + interval '1 month' - interval '1 day')::date) - greatest(p_from, k.month) + 1)
        / extract(day from (k.month + interval '1 month' - interval '1 day'))))::bigint as spend
    from public.keyword_spend k
    where k.workspace_id = v_ws and k.month <= p_to and (k.month + interval '1 month')::date > p_from
    group by 1
  ),
  kw_leads as (
    select public.norm_keyword(l.keyword) as nk, min(l.keyword) as keyword,
      count(*) as leads,
      count(*) filter (where l.status = 'contracted') as contracts,
      coalesce(sum(l.contract_amount) filter (where l.status = 'contracted'), 0) as revenue
    from l join public.channels c on c.id = l.channel_id and c.code = 'naver_sa'
    where public.norm_keyword(l.keyword) is not null
    group by 1
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'settings', (select jsonb_build_object('roas_high', w.roas_high, 'roas_low', w.roas_low, 'contract_term', w.contract_term)
                 from public.workspaces w where w.id = v_ws),
    'channels', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', c.id, 'name', c.name, 'kind', c.kind, 'code', c.code, 'hidden', c.hidden,
          'spend', coalesce(s.spend, 0), 'leads', coalesce(b.leads, 0),
          'contracts', coalesce(b.contracts, 0), 'revenue', coalesce(b.revenue, 0))
        order by c.position, c.name)
      from public.channels c
      left join spend s on s.channel_id = c.id
      left join by_channel b on b.channel_id = c.id
      where c.workspace_id = v_ws), '[]'),
    'unknown', (select jsonb_build_object('leads', leads, 'contracts', contracts, 'revenue', revenue)
                from by_channel where channel_id is null),
    'keywords', coalesce((
      select jsonb_agg(jsonb_build_object(
          'keyword', coalesce(ks.keyword, kl.keyword), 'spend', coalesce(ks.spend, 0),
          'leads', coalesce(kl.leads, 0), 'contracts', coalesce(kl.contracts, 0), 'revenue', coalesce(kl.revenue, 0))
        order by coalesce(ks.spend, 0) desc, coalesce(kl.leads, 0) desc, coalesce(ks.keyword, kl.keyword))
      from kw_spend ks full join kw_leads kl on kl.nk = ks.nk), '[]'),
    'has_keyword_spend', exists (select 1 from kw_spend),
    'attribution', coalesce((select jsonb_object_agg(attribution, n) from (select attribution, count(*) as n from l group by 1) a), '{}'),
    -- 계약 결과(계약·실패)가 아직 없는데 등록된 지 7일 지난 문의
    'stale', (select count(*) from l where status in ('new', 'consulting') and created_at < now() - interval '7 days')
  ) into v_result;
  return v_result;
end $$;

revoke execute on function public.norm_keyword(text), public.performance(date, date) from public, anon;
grant execute on function public.norm_keyword(text), public.performance(date, date) to authenticated;
