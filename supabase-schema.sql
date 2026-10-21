-- ============================================================
-- SCORE MY COMBINE — Multi-tenant Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- ------------------------------------------------------------
-- 1. EVENTS  (one row per combine)
-- ------------------------------------------------------------
create table if not exists events (
  id          text primary key,          -- e.g. 'demo', 'ae2027'
  name        text not null,
  description text,
  date        date,
  location    text,
  active      boolean default true,
  created_at  timestamptz default now()
);

-- Seed the first two events
insert into events (id, name, description, date, location) values
  ('demo',   'Demo Combine',    'Public demo — seed data and prospect access', null, 'Online'),
  ('ae2027', 'AE Combine 2027', 'First live AE combine event',                 null, 'TBD')
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- 2. DC_ATHLETES  (one row per registered athlete per event)
-- ------------------------------------------------------------
create table if not exists dc_athletes (
  id            uuid primary key default gen_random_uuid(),
  event_id      text not null references events(id) on delete cascade,
  athlete_id    text not null,            -- e.g. 'DC26-0042'
  first_name    text not null,
  last_name     text not null,
  email         text,
  dob           date,
  gender        text,
  events        text[],                   -- e.g. '{pullup,dash,jump}'
  registered_at timestamptz default now(),
  unique(event_id, athlete_id)
);

create index if not exists idx_dc_athletes_event on dc_athletes(event_id);
create index if not exists idx_dc_athletes_event_athlete on dc_athletes(event_id, athlete_id);

-- ------------------------------------------------------------
-- 3. DC_RESULTS  (one row per attempt)
-- ------------------------------------------------------------
create table if not exists dc_results (
  id           uuid primary key default gen_random_uuid(),
  event_id     text not null references events(id) on delete cascade,
  athlete_id   text not null,
  athlete_name text,
  event        text not null,             -- 'pullup' | 'dash' | 'jump'
  attempt_num  int  not null default 1,
  value        numeric not null,
  score        int,
  official_id  text,
  voided       boolean default false,
  timestamp    timestamptz default now()
);

create index if not exists idx_dc_results_event on dc_results(event_id);
create index if not exists idx_dc_results_event_athlete on dc_results(event_id, athlete_id);
create index if not exists idx_dc_results_event_athlete_event on dc_results(event_id, athlete_id, event);

-- ------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- ------------------------------------------------------------

-- EVENTS — public read
alter table events enable row level security;
create policy "events_public_read" on events for select using (true);

-- DC_ATHLETES — public read + anon insert (registration)
alter table dc_athletes enable row level security;
create policy "athletes_public_read"   on dc_athletes for select using (true);
create policy "athletes_anon_insert"   on dc_athletes for insert with check (true);

-- DC_RESULTS — public read + anon insert (official entry)
alter table dc_results enable row level security;
create policy "results_public_read"    on dc_results for select using (true);
create policy "results_anon_insert"    on dc_results for insert with check (true);
-- Admin void: UPDATE allowed (service role bypasses RLS anyway, but explicit policy is clean)
create policy "results_anon_update"    on dc_results for update using (true);
create policy "results_anon_delete"    on dc_results for delete using (true);

-- ------------------------------------------------------------
-- 4b. DC_OFFICIALS  (one row per official per event)
-- ------------------------------------------------------------
create table if not exists dc_officials (
  id         uuid primary key default gen_random_uuid(),
  event_id   text not null references events(id) on delete cascade,
  name       text not null,
  passcode   text not null,
  created_at timestamptz default now(),
  unique(event_id, name)
);

create index if not exists idx_dc_officials_event on dc_officials(event_id);

-- DC_OFFICIALS — anon read (for login check) + admin insert/update/delete
alter table dc_officials enable row level security;
create policy "officials_public_read"   on dc_officials for select using (true);
create policy "officials_anon_insert"   on dc_officials for insert with check (true);
create policy "officials_anon_update"   on dc_officials for update using (true);
create policy "officials_anon_delete"   on dc_officials for delete using (true);

-- ------------------------------------------------------------
-- 5. DC_DEMO_CODES  (one row per prospect demo session)
-- ------------------------------------------------------------
-- Demo event slugs use the pattern: 'demo-XXXXXX' (6 random alphanumeric chars)
-- Each prospect gets their own isolated event slug so results never cross-pollinate.
-- Expired sessions are cleaned up nightly by pg_cron (see section 7 below).
-- ------------------------------------------------------------
create table if not exists dc_demo_codes (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,          -- 6-digit numeric code sent to prospect
  event_id     text not null,                 -- generated slug e.g. 'demo-a3f9k2'
  email        text not null,
  name         text not null,
  org          text,
  activated_at timestamptz,                   -- set when prospect first uses the code
  expires_at   timestamptz not null,          -- default now() + 48 hours
  created_at   timestamptz default now()
);

create index if not exists idx_dc_demo_codes_code     on dc_demo_codes(code);
create index if not exists idx_dc_demo_codes_event_id on dc_demo_codes(event_id);
create index if not exists idx_dc_demo_codes_expires  on dc_demo_codes(expires_at);

-- DC_DEMO_CODES — public SELECT by code (gate check) + anon INSERT (request form) + anon UPDATE (mark activated)
alter table dc_demo_codes enable row level security;
create policy "demo_codes_public_read"   on dc_demo_codes for select using (true);
create policy "demo_codes_anon_insert"   on dc_demo_codes for insert with check (true);
create policy "demo_codes_anon_update"   on dc_demo_codes for update using (true);
create policy "demo_codes_anon_delete"   on dc_demo_codes for delete using (true);

-- ------------------------------------------------------------
-- 6. EVENTS — also allow anon INSERT (for demo event slug creation via Edge Function)
-- ------------------------------------------------------------
create policy "events_anon_insert"  on events for insert with check (true);
create policy "events_anon_delete"  on events for delete using (true);

-- ------------------------------------------------------------
-- 7. PG_CRON — nightly demo session cleanup
-- ------------------------------------------------------------
-- Run this ONCE in Supabase SQL Editor to register the cron job.
-- Requires pg_cron extension (enabled by default on Supabase Pro).
--
-- select cron.schedule(
--   'cleanup-expired-demo-sessions',   -- job name
--   '0 4 * * *',                       -- 4am UTC daily
--   $$
--     delete from events
--     where id like 'demo-%'
--       and id in (
--         select event_id from dc_demo_codes
--         where expires_at < now()
--       );
--   $$
-- );
--
-- The DELETE on events cascades to dc_athletes, dc_results, dc_officials
-- (all have ON DELETE CASCADE on event_id FK).
-- dc_demo_codes rows are NOT cascaded — they are deleted explicitly:
--
-- select cron.schedule(
--   'cleanup-expired-demo-codes',
--   '0 4 * * *',
--   $$
--     delete from dc_demo_codes where expires_at < now();
--   $$
-- );
--
-- To verify jobs are registered:
--   select * from cron.job;
-- To unschedule:
--   select cron.unschedule('cleanup-expired-demo-sessions');
--   select cron.unschedule('cleanup-expired-demo-codes');
