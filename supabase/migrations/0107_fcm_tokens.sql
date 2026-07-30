-- Firebase Cloud Messaging device tokens (native Android push delivery)
create table if not exists fcm_tokens (
  id          bigint generated always as identity primary key,
  user_type   text   not null check (user_type in ('owner','staff','student')),
  user_id     text   not null,
  academy_id  uuid   references academies(id) on delete cascade not null,
  token       text   not null unique,
  platform    text   not null default 'android',
  created_at  timestamptz not null default now()
);

create index if not exists fcm_tokens_user_idx
  on fcm_tokens (user_id, user_type, academy_id);

-- wide-open anon access (matches existing 0028 push_subscriptions pattern for custom-token auth)
alter table fcm_tokens enable row level security;

create policy "anon full access fcm_tokens"
  on fcm_tokens for all using (true) with check (true);
