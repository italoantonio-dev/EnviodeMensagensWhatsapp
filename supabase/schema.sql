-- Schema base para migrar do NeDB local para Supabase (PostgreSQL)
-- Execute no SQL Editor do Supabase

create extension if not exists pgcrypto;

create table if not exists public.recipients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('private', 'group')),
  destination text not null,
  jid text not null,
  is_default boolean not null default false,
  is_cycle_target boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists recipients_jid_unique on public.recipients (jid);
create index if not exists recipients_type_idx on public.recipients (type);
create index if not exists recipients_default_idx on public.recipients (is_default);
create index if not exists recipients_cycle_target_idx on public.recipients (is_cycle_target);

create table if not exists public.dispatches (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.recipients(id) on delete cascade,
  source_type text not null check (source_type in ('manual', 'cycle')),
  cycle_day integer not null default 0,
  message_text text not null default '',
  mode text not null check (mode in ('manual-now', 'scheduled')),
  send_at timestamptz not null,
  status text not null check (status in ('pending', 'sent', 'failed')),
  sent_at timestamptz,
  error_message text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dispatches_status_idx on public.dispatches (status);
create index if not exists dispatches_send_at_idx on public.dispatches (send_at);
create index if not exists dispatches_recipient_idx on public.dispatches (recipient_id);

create table if not exists public.cycles (
  id text primary key,
  name text not null,
  is_selected boolean not null default false,
  start_date date not null,
  is_active boolean not null default true,
  days jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists cycles_single_selected_idx on public.cycles ((is_selected)) where is_selected = true;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists recipients_set_updated_at on public.recipients;
create trigger recipients_set_updated_at
before update on public.recipients
for each row execute function public.set_updated_at();

drop trigger if exists dispatches_set_updated_at on public.dispatches;
create trigger dispatches_set_updated_at
before update on public.dispatches
for each row execute function public.set_updated_at();

drop trigger if exists cycles_set_updated_at on public.cycles;
create trigger cycles_set_updated_at
before update on public.cycles
for each row execute function public.set_updated_at();
