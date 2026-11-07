create table if not exists users (
  id            uuid primary key,
  username      text unique not null,
  display_name  text,
  role          text not null default 'guard' check (role in ('guard', 'manager')),
  password      text not null,                 -- pbkdf2_sha256$iterations$salt$hash
  active        boolean not null default true,
  created_at    timestamptz default now()
);

create table if not exists submissions (
  id               uuid primary key,
  user_id          uuid references users(id),
  username         text,
  guard            text,
  checklist_title  text,
  checklist_code   text,
  results          jsonb,
  notes            text default '',
  submitted_at     timestamptz,
  received_at      timestamptz default now(),
  prev_hash        text default '',
  hash             text default ''
);
create index if not exists submissions_submitted_at_idx on submissions (submitted_at desc);
create index if not exists submissions_username_idx on submissions (username);

create table if not exists user_checklists (
  id        uuid primary key,
  user_id   uuid references users(id),
  code      text not null,
  title     text,
  saved_at  timestamptz default now(),
  deleted   boolean not null default false,
  unique (user_id, code)
);

create table if not exists company_settings (
  key         text primary key,
  value       text,
  updated_at  timestamptz default now(),
  updated_by  text
);

create table if not exists company_checklists (
  id          uuid primary key,
  code        text unique not null,
  title       text,
  created_by  text,
  created_at  timestamptz default now(),
  active      boolean not null default true
);

alter table users              enable row level security;
alter table submissions        enable row level security;
alter table user_checklists    enable row level security;
alter table company_settings   enable row level security;
alter table company_checklists enable row level security;