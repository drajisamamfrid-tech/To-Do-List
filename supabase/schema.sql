-- To-Do List: database schema for Supabase
-- Run this once in Supabase Dashboard -> SQL Editor -> New query -> Run.

-- ---------- Categories ----------
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  workspace   text not null check (workspace in ('office', 'personal')),
  name        text not null check (char_length(name) between 1 and 50),
  color       text not null default '#6366f1',
  created_at  timestamptz not null default now()
);

-- ---------- Tasks ----------
create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  workspace    text not null check (workspace in ('office', 'personal')),
  category_id  uuid references public.categories (id) on delete set null,
  title        text not null check (char_length(title) between 1 and 200),
  notes        text,
  priority     text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  status       text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  due_date     date,
  due_time     time,
  repeat       text not null default 'none' check (repeat in ('none', 'daily', 'weekly', 'monthly')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists tasks_user_idx on public.tasks (user_id, status, due_date);
create index if not exists categories_user_idx on public.categories (user_id, workspace);

-- Keep updated_at / completed_at in sync automatically
create or replace function public.tasks_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end $$;

drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before insert or update on public.tasks
  for each row execute function public.tasks_touch();

-- ---------- Row Level Security: each user sees only their own data ----------
alter table public.categories enable row level security;
alter table public.tasks      enable row level security;

drop policy if exists "own categories" on public.categories;
create policy "own categories" on public.categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own tasks" on public.tasks;
create policy "own tasks" on public.tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- Realtime: live sync between phone and desktop ----------
do $$
begin
  alter publication supabase_realtime add table public.tasks, public.categories;
exception when duplicate_object then null;
end $$;

-- Upgrade for databases created before recurring tasks existed
alter table public.tasks add column if not exists repeat text not null default 'none'
  check (repeat in ('none', 'daily', 'weekly', 'monthly'));
