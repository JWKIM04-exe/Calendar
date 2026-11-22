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
  stay text not null check (stay in ('in', 'out', 'over', 'leave', 'home')),
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

-- 보안 규칙: 링크(그룹 코드)를 아는 사람은 누구나 읽고 쓸 수 있습니다.
alter table cal_members enable row level security;
alter table cal_events  enable row level security;
alter table cal_stays   enable row level security;
alter table cal_memos   enable row level security;

drop policy if exists "cal public" on cal_members;
drop policy if exists "cal public" on cal_events;
drop policy if exists "cal public" on cal_stays;
drop policy if exists "cal public" on cal_memos;
create policy "cal public" on cal_members for all to anon, authenticated using (true) with check (true);
create policy "cal public" on cal_events  for all to anon, authenticated using (true) with check (true);
create policy "cal public" on cal_stays   for all to anon, authenticated using (true) with check (true);
create policy "cal public" on cal_memos   for all to anon, authenticated using (true) with check (true);

grant select, insert, update, delete on cal_members, cal_events, cal_stays, cal_memos to anon, authenticated;
