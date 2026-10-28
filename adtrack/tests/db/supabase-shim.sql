-- 테스트 전용: 일반 PostgreSQL 에 Supabase 가 제공하는 최소한의 것(역할, auth 스키마, auth.uid())을 흉내 낸다.
-- 기본 grant 도 Supabase 처럼 anon/authenticated 에 모두 열어 두어, 데이터 분리가 grant 부족이 아니라
-- 마이그레이션의 RLS 정책 덕분인지를 확인한다.

-- 역할은 서버 전체에 하나라서, 같은 서버에서 테스트 DB 를 여러 번 만들 수 있게 없을 때만 만든다
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema auth;
create table auth.users (
  id uuid primary key,
  email text not null
);

create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(
    current_setting('request.jwt.claim.sub', true),
    current_setting('request.jwt.claims', true)::jsonb ->> 'sub'
  ), '')::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
