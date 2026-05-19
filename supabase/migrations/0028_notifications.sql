-- notifications feed per user
create table if not exists notifications (
  id             bigint generated always as identity primary key,
  academy_id     uuid   references academies(id) on delete cascade not null,
  recipient_type text   not null check (recipient_type in ('owner','staff','student')),
  recipient_id   text   not null,
  title          text   not null,
  body           text   not null,
  type           text   not null default 'info',
  link           text,
  read           boolean not null default false,
  created_at     timestamptz not null default now()
);

create index if not exists notifications_recipient_idx
  on notifications (recipient_id, recipient_type, read);
create index if not exists notifications_academy_created_idx
  on notifications (academy_id, created_at desc);

-- browser push subscriptions (one row per device per user)
create table if not exists push_subscriptions (
  id          bigint generated always as identity primary key,
  user_type   text   not null check (user_type in ('owner','staff','student')),
  user_id     text   not null,
  academy_id  uuid   references academies(id) on delete cascade not null,
  endpoint    text   not null unique,
  p256dh      text   not null,
  auth        text   not null,
  created_at  timestamptz not null default now()
);

create index if not exists push_subs_user_idx
  on push_subscriptions (user_id, user_type, academy_id);

-- wide-open anon access (matches existing 0019d pattern for custom-token auth)
alter table notifications       enable row level security;
alter table push_subscriptions  enable row level security;

create policy "anon full access notifications"
  on notifications for all using (true) with check (true);

create policy "anon full access push_subscriptions"
  on push_subscriptions for all using (true) with check (true);

-- enable realtime so the bell updates live
alter publication supabase_realtime add table notifications;
