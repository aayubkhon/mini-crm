-- 1/3. Типы и таблицы. Права и политики: в файлах 2 и 3.

-- Default deny для всего, что будет создано дальше.
-- Supabase по умолчанию выдаёт anon и authenticated полный доступ к новым
-- таблицам и функциям в public. Убираем это, права выдаются только явно.
alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

-- Схема для служебных функций. Она не опубликована через API,
-- поэтому is_manager() и другие нельзя вызвать как RPC.
create schema if not exists private;
alter default privileges in schema private revoke all on functions from public;

create type public.user_role as enum ('manager', 'executor');

create type public.task_status as enum (
  'new',          -- Новая
  'in_progress',  -- В работе
  'in_review',    -- На проверке
  'accepted',     -- Принята
  'rework'        -- На доработке
);

-- Роль хранится только здесь, user_metadata нигде не используется.
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null check (full_name ~ '\S'),
  role       public.user_role not null,
  created_at timestamptz not null default now()
);

create table public.objects (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (name ~ '\S' and char_length(name) <= 200),
  address    text not null check (address ~ '\S' and char_length(address) <= 500),
  created_at timestamptz not null default now()
);

create table public.tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (title ~ '\S' and char_length(title) <= 200),
  description text not null default '' check (char_length(description) <= 5000),
  -- restrict: объект с задачами, включая мягко удалённые, удалить нельзя
  object_id   uuid not null references public.objects (id) on delete restrict,
  executor_id uuid not null references public.profiles (id) on delete restrict,
  status      public.task_status not null default 'new',
  -- Автор всегда берётся из JWT. Клиент не имеет права писать в эту колонку.
  author_id   uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at  timestamptz not null default now(),
  -- Мягкое удаление: заполняется только функцией delete_task.
  deleted_at  timestamptz
);

create index tasks_executor_id_idx on public.tasks (executor_id);
create index tasks_object_id_idx on public.tasks (object_id);

create table public.task_history (
  id          bigint generated always as identity primary key,
  -- restrict: задачи удаляются мягко, поэтому история не исчезает никогда
  task_id     uuid not null references public.tasks (id) on delete restrict,
  from_status public.task_status,
  to_status   public.task_status not null,
  actor_id    uuid not null references public.profiles (id) on delete restrict,
  comment     text check (char_length(comment) <= 2000),
  created_at  timestamptz not null default now(),

  -- Последняя линия защиты: в истории могут быть только разрешённые переходы.
  constraint task_history_allowed_transition check (
    (from_status is null          and to_status = 'new')
    or (from_status = 'new'         and to_status = 'in_progress')
    or (from_status = 'in_progress' and to_status = 'in_review')
    or (from_status = 'in_review'   and to_status in ('accepted', 'rework'))
    or (from_status = 'rework'      and to_status = 'in_progress')
  ),
  -- coalesce обязателен: CHECK считает NULL успешным результатом.
  constraint task_history_rework_needs_comment check (
    to_status <> 'rework' or coalesce(comment ~ '\S', false)
  )
);

create index task_history_task_id_idx on public.task_history (task_id, id);
create index task_history_actor_id_idx on public.task_history (actor_id);
