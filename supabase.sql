-- 대체복무 공유 캘린더 테이블
-- Supabase 대시보드 → SQL Editor → New query 에 전체를 붙여넣고 Run 하세요.
-- 헬스기록의 posts/community 테이블과 이름이 겹치지 않게 cal_ 로 시작합니다.

create table if not exists cal_members (
  grp text not null check (char_length(grp) <= 40),
  id text not null check (char_length(id) <= 40),
  name text not null check (char_length(name) <= 30),
  org text check (char_length(org) <= 60),
  room text check (char_length(room) <= 60),
  st date,
  en date,
  updated_at timestamptz not null default now(),
  primary key (grp, id)
);

create table if not exists cal_events (
  id uuid primary key default gen_random_uuid(),
  grp text not null check (char_length(grp) <= 40),
  date date not null,
  time text check (char_length(time) <= 5),
  text text not null check (char_length(text) <= 200),
  kind text check (char_length(kind) <= 20),
  owner text not null check (char_length(owner) <= 40),
  done boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists cal_events_grp_date on cal_events (grp, date);

create table if not exists cal_stays (
  grp text not null check (char_length(grp) <= 40),
  member text not null check (char_length(member) <= 40),
  date date not null,
  stay text not null,
  primary key (grp, member, date)
);

create table if not exists cal_memos (
  grp text not null check (char_length(grp) <= 40),
  member text not null check (char_length(member) <= 40),
  week date not null,
  goal text check (char_length(goal) <= 2000),
  memo text check (char_length(memo) <= 2000),
  primary key (grp, member, week)
);

-- 거주 형태는 직접 입력도 가능 (최대 30자)
alter table cal_stays drop constraint if exists cal_stays_stay_check;
alter table cal_stays add constraint cal_stays_stay_check check (char_length(stay) between 1 and 30);

-- ===================== 보안 =====================
-- 누구나 읽을 수는 있지만, 쓰기는 아래 함수(비밀번호 확인)로만 할 수 있습니다.
-- 이 파일 전체를 여러 번 실행해도 괜찮습니다.

create extension if not exists pgcrypto with schema extensions;

alter table cal_members add column if not exists pw_hash text;

create table if not exists cal_sessions (
  token_hash text primary key,
  grp text not null,
  member text not null,
  created_at timestamptz not null default now()
);

alter table cal_members  enable row level security;
alter table cal_events   enable row level security;
alter table cal_stays    enable row level security;
alter table cal_memos    enable row level security;
alter table cal_sessions enable row level security;  -- 정책 없음 = 바깥에서 접근 불가

drop policy if exists "cal public" on cal_members;
drop policy if exists "cal public" on cal_events;
drop policy if exists "cal public" on cal_stays;
drop policy if exists "cal public" on cal_memos;
drop policy if exists "cal read" on cal_members;
drop policy if exists "cal read" on cal_events;
drop policy if exists "cal read" on cal_stays;
drop policy if exists "cal read" on cal_memos;
create policy "cal read" on cal_members for select to anon, authenticated using (true);
create policy "cal read" on cal_events  for select to anon, authenticated using (true);
create policy "cal read" on cal_stays   for select to anon, authenticated using (true);
create policy "cal read" on cal_memos   for select to anon, authenticated using (true);

revoke all on cal_members, cal_events, cal_stays, cal_memos, cal_sessions from anon, authenticated;
grant select (grp, id, name, org, room, st, en, updated_at) on cal_members to anon, authenticated;  -- 비밀번호 열은 안 보임
grant select on cal_events, cal_stays, cal_memos to anon, authenticated;

-- ---------- 내부용 함수 ----------
create or replace function cal_hash(t text) returns text
language sql immutable set search_path = public, extensions
as $$ select encode(extensions.digest(t, 'sha256'), 'hex') $$;

create or replace function cal_new_session(p_grp text, p_member text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare t text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  insert into cal_sessions (token_hash, grp, member) values (cal_hash(t), p_grp, p_member);
  return t;
end $$;

create or replace function cal_auth(p_grp text, p_token text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare m text;
begin
  select member into m from cal_sessions where token_hash = cal_hash(coalesce(p_token, '')) and grp = p_grp;
  if m is null then raise exception 'SESSION_INVALID'; end if;
  return m;
end $$;

revoke execute on function cal_new_session(text, text) from public, anon, authenticated;
revoke execute on function cal_auth(text, text) from public, anon, authenticated;

-- ---------- 등록 · 로그인 ----------
create or replace function cal_register(p_grp text, p_name text, p_org text, p_room text, p_st date, p_en date, p_pw text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare new_id text := substr(md5(random()::text || clock_timestamp()::text), 1, 12);
begin
  if coalesce(char_length(p_pw), 0) < 4 then raise exception 'PW_SHORT'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'NAME_EMPTY'; end if;
  if exists (select 1 from cal_members where grp = p_grp and name = trim(p_name)) then raise exception 'NAME_TAKEN'; end if;
  insert into cal_members (grp, id, name, org, room, st, en, pw_hash)
  values (p_grp, new_id, trim(p_name), nullif(p_org, ''), nullif(p_room, ''), p_st, p_en, extensions.crypt(p_pw, extensions.gen_salt('bf')));
  return json_build_object('id', new_id, 'token', cal_new_session(p_grp, new_id));
end $$;

-- 비밀번호를 아직 안 정한 기존 사람은 처음 로그인할 때 입력한 비밀번호가 설정됩니다.
create or replace function cal_login(p_grp text, p_id text, p_pw text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare h text; found_member boolean;
begin
  select true, pw_hash into found_member, h from cal_members where grp = p_grp and id = p_id;
  if found_member is null then raise exception 'NO_MEMBER'; end if;
  if h is null then
    if coalesce(char_length(p_pw), 0) < 4 then raise exception 'PW_SHORT'; end if;
    update cal_members set pw_hash = extensions.crypt(p_pw, extensions.gen_salt('bf')) where grp = p_grp and id = p_id;
  elsif h <> extensions.crypt(coalesce(p_pw, ''), h) then
    perform pg_sleep(0.5);
    raise exception 'PW_WRONG';
  end if;
  return cal_new_session(p_grp, p_id);
end $$;

create or replace function cal_logout(p_grp text, p_token text) returns void
language sql security definer set search_path = public, extensions as $$
  delete from cal_sessions where token_hash = cal_hash(coalesce(p_token, '')) and grp = p_grp;
$$;

-- ---------- 본인 것만 고치기 ----------
create or replace function cal_save_member(p_grp text, p_token text, p_name text, p_org text, p_room text, p_st date, p_en date, p_new_pw text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare m text := cal_auth(p_grp, p_token);
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'NAME_EMPTY'; end if;
  if exists (select 1 from cal_members where grp = p_grp and name = trim(p_name) and id <> m) then raise exception 'NAME_TAKEN'; end if;
  update cal_members set name = trim(p_name), org = nullif(p_org, ''), room = nullif(p_room, ''), st = p_st, en = p_en, updated_at = now()
  where grp = p_grp and id = m;
  if coalesce(p_new_pw, '') <> '' then
    if char_length(p_new_pw) < 4 then raise exception 'PW_SHORT'; end if;
    update cal_members set pw_hash = extensions.crypt(p_new_pw, extensions.gen_salt('bf')) where grp = p_grp and id = m;
  end if;
end $$;

create or replace function cal_add_event(p_grp text, p_token text, p_date date, p_time text, p_text text, p_kind text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare m text := cal_auth(p_grp, p_token);
begin
  insert into cal_events (grp, date, time, text, kind, owner) values (p_grp, p_date, nullif(p_time, ''), p_text, p_kind, m);
end $$;

create or replace function cal_update_event(p_grp text, p_token text, p_id uuid, p_done boolean)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare m text := cal_auth(p_grp, p_token);
begin
  update cal_events set done = p_done where id = p_id and grp = p_grp and owner = m;
  if not found then raise exception 'NOT_OWNER'; end if;
end $$;

create or replace function cal_delete_event(p_grp text, p_token text, p_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare m text := cal_auth(p_grp, p_token);
begin
  delete from cal_events where id = p_id and grp = p_grp and owner = m;
  if not found then raise exception 'NOT_OWNER'; end if;
end $$;

create or replace function cal_set_stay(p_grp text, p_token text, p_date date, p_stay text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare m text := cal_auth(p_grp, p_token);
begin
  insert into cal_stays (grp, member, date, stay) values (p_grp, m, p_date, p_stay)
  on conflict (grp, member, date) do update set stay = excluded.stay;
end $$;

create or replace function cal_set_memo(p_grp text, p_token text, p_week date, p_goal text, p_memo text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare m text := cal_auth(p_grp, p_token);
begin
  insert into cal_memos (grp, member, week, goal, memo) values (p_grp, m, p_week, p_goal, p_memo)
  on conflict (grp, member, week) do update set goal = excluded.goal, memo = excluded.memo;
end $$;

grant execute on function cal_register(text, text, text, text, date, date, text) to anon, authenticated;
grant execute on function cal_login(text, text, text) to anon, authenticated;
grant execute on function cal_logout(text, text) to anon, authenticated;
grant execute on function cal_save_member(text, text, text, text, text, date, date, text) to anon, authenticated;
grant execute on function cal_add_event(text, text, date, text, text, text) to anon, authenticated;
grant execute on function cal_update_event(text, text, uuid, boolean) to anon, authenticated;
grant execute on function cal_delete_event(text, text, uuid) to anon, authenticated;
grant execute on function cal_set_stay(text, text, date, text) to anon, authenticated;
grant execute on function cal_set_memo(text, text, date, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
