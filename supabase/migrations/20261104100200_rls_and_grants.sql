-- 3/3. Права и политики RLS.
--
-- Проверка идёт в два слоя:
--   GRANT: какие действия и колонки доступны роли authenticated вообще;
--   RLS:   к каким строкам эти действия применимы.
-- Нет политики на действие значит действие запрещено (default deny).

----------------------------------------------------------------------
-- Сначала забираем всё
----------------------------------------------------------------------

revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on schema public from anon;
revoke all on schema private from public, anon;

-- service_role обходит RLS, поэтому удаление задач и истории закрываем и для него.
revoke delete, truncate on public.tasks, public.task_history from service_role;

alter table public.profiles     enable row level security;
alter table public.objects      enable row level security;
alter table public.tasks        enable row level security;
alter table public.task_history enable row level security;

----------------------------------------------------------------------
-- Затем выдаём только нужное и только authenticated
----------------------------------------------------------------------

grant usage on schema public to authenticated;
-- Политики выполняются от имени пользователя, поэтому ему нужен доступ к помощникам.
-- Через API они недоступны: схема private не опубликована.
grant usage on schema private to authenticated;
grant execute on function private.is_manager() to authenticated;
grant execute on function private.shares_task_with(uuid) to authenticated;
grant execute on function public.change_task_status(uuid, public.task_status, text) to authenticated;
grant execute on function public.delete_task(uuid) to authenticated;

-- profiles: только чтение. Записи создаёт администратор, сменить роль через API нельзя.
grant select on public.profiles to authenticated;

grant select, delete on public.objects to authenticated;
grant insert (name, address), update (name, address) on public.objects to authenticated;

-- tasks: status, author_id, created_at и deleted_at намеренно не входят в список.
-- Запись в них отклоняется ещё до проверки RLS. Права DELETE нет: только delete_task.
grant select on public.tasks to authenticated;
grant insert (title, description, object_id, executor_id),
      update (title, description, object_id, executor_id)
  on public.tasks to authenticated;

-- task_history: только чтение. Пишут только security definer функции.
grant select on public.task_history to authenticated;

----------------------------------------------------------------------
-- profiles
----------------------------------------------------------------------

-- Политик insert/update/delete нет: изменить профиль через API нельзя.
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select private.is_manager())
    or private.shares_task_with(id)
  );

----------------------------------------------------------------------
-- objects
----------------------------------------------------------------------

-- Исполнитель видит только объекты, где у него есть действующая задача.
create policy objects_select on public.objects
  for select to authenticated
  using (
    (select private.is_manager())
    or exists (
      select 1 from public.tasks t
      where t.object_id = objects.id
        and t.deleted_at is null
        and t.executor_id = (select auth.uid())
    )
  );

create policy objects_insert on public.objects
  for insert to authenticated
  with check ((select private.is_manager()));

create policy objects_update on public.objects
  for update to authenticated
  using ((select private.is_manager()))
  with check ((select private.is_manager()));

create policy objects_delete on public.objects
  for delete to authenticated
  using ((select private.is_manager()));

----------------------------------------------------------------------
-- tasks
----------------------------------------------------------------------

-- Удалённые задачи не видны никому. Исполнитель видит только свои.
create policy tasks_select on public.tasks
  for select to authenticated
  using (
    deleted_at is null
    and (
      (select private.is_manager())
      or executor_id = (select auth.uid())
    )
  );

create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (
    (select private.is_manager())
    and author_id = (select auth.uid())
    and status = 'new'
    and deleted_at is null
  );

-- Политика только для постановщика. Исполнитель меняет статус через RPC.
create policy tasks_update on public.tasks
  for update to authenticated
  using ((select private.is_manager()) and deleted_at is null)
  with check ((select private.is_manager()) and deleted_at is null);

-- Политики delete нет: задачу удаляет только RPC delete_task.

----------------------------------------------------------------------
-- task_history
----------------------------------------------------------------------

-- Только чтение. Записи никогда не удаляются, но история удалённой задачи скрыта.
create policy task_history_select on public.task_history
  for select to authenticated
  using (
    exists (
      select 1 from public.tasks t
      where t.id = task_history.task_id
        and t.deleted_at is null
        and (
          (select private.is_manager())
          or t.executor_id = (select auth.uid())
        )
    )
  );

-- API сразу видит новые таблицы и функцию.
notify pgrst, 'reload schema';
