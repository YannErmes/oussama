-- ============================================================
-- LoyalUp Supabase schema — run ONCE in Supabase SQL Editor.
-- Mirrors loyal.db so the app works identically online.
-- RLS is permissive for launch (prototype); tighten before
-- handling real customer PII (see STRICT note at bottom).
-- ============================================================

create table if not exists businesses (
  id text primary key,
  name text unique not null,
  pw text not null default '',
  created_at timestamptz default now()
);

create table if not exists members (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  name text not null,
  phone text default '',
  visits int default 0, stamps int default 0,
  points int default 0, streak int default 0,
  last_visit text, wallet_added int default 0,
  created_at timestamptz default now()
);
create index if not exists members_biz on members(business_id);

create table if not exists messages (
  id bigint generated always as identity primary key,
  member_id text not null references members(id) on delete cascade,
  text text not null,
  created_at timestamptz default now()
);
create index if not exists messages_member on messages(member_id);

create table if not exists rewards (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  name text not null, cost int default 10, active int default 1
);

create table if not exists promos (
  id text primary key,
  business_id text not null references businesses(id) on delete cascade,
  text text not null,
  created_at timestamptz default now()
);

create table if not exists config (
  business_id text not null references businesses(id) on delete cascade,
  k text not null, v text default '',
  primary key (business_id, k)
);

-- Prototype RLS: allow anon read/write for launch; tighten later (see STRICT note).
alter table businesses enable row level security;
alter table members enable row level security;
alter table messages enable row level security;
alter table rewards enable row level security;
alter table promos enable row level security;
alter table config enable row level security;

drop policy if exists open_all on businesses; create policy open_all on businesses for all using (true) with check (true);
drop policy if exists open_all on members;    create policy open_all on members    for all using (true) with check (true);
drop policy if exists open_all on messages;   create policy open_all on messages   for all using (true) with check (true);
drop policy if exists open_all on rewards;    create policy open_all on rewards    for all using (true) with check (true);
drop policy if exists open_all on promos;     create policy open_all on promos     for all using (true) with check (true);
drop policy if exists open_all on config;     create policy open_all on config     for all using (true) with check (true);

-- STRICT (later, before real PII): switch to Supabase Auth for businesses,
-- store business owner uid on each row, and scope policies to auth.uid().
