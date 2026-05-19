alter table notifications
  add column if not exists action_label  text,
  add column if not exists actioned_at   timestamptz;
