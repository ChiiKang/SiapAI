-- One row per monitored session; latest state only (plan §5).
-- No event-history table in V1.

create table if not exists public.agents (
  session_id     uuid primary key,
  display_name   text not null,
  machine_name   text not null,
  agent_kind     text not null default 'agent',
  status         text not null check (status in ('RUNNING', 'READY')),
  started_at     timestamptz,
  updated_at     timestamptz not null,
  last_event_id  uuid not null
);

-- RLS on with no policies: the table is reachable only through the Edge
-- Functions (service role). The iOS app reads via GET /agents, never with a
-- direct database credential.
alter table public.agents enable row level security;
