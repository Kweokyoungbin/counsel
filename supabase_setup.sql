-- 친구야, 짐을 나누자: 로그인 사용자별 앱 상태 저장
-- Supabase Dashboard > SQL Editor에서 전체 실행하세요.
create table if not exists public.user_app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_app_state enable row level security;
drop policy if exists "Users can read own app state" on public.user_app_state;
create policy "Users can read own app state" on public.user_app_state
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users can insert own app state" on public.user_app_state;
create policy "Users can insert own app state" on public.user_app_state
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users can update own app state" on public.user_app_state;
create policy "Users can update own app state" on public.user_app_state
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update on public.user_app_state to authenticated;
