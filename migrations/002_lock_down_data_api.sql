-- Supabase auto-exposes the public schema through its REST/GraphQL Data API using the
-- anon/authenticated keys. This app never uses that API: the server connects directly
-- to Postgres as the table owner (which bypasses RLS). Enabling RLS with NO policies
-- therefore denies all Data API access while leaving the app unaffected.
-- Harmless on plain Postgres / PGlite.
alter table workspaces enable row level security;
alter table gmail_accounts enable row level security;
alter table settings enable row level security;
alter table teams enable row level security;
alter table members enable row level security;
alter table emails enable row level security;
alter table ai_analyses enable row level security;
alter table requirements enable row level security;
alter table tasks enable row level security;
alter table events enable row level security;
alter table schema_migrations enable row level security;
