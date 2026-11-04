-- 2/3. Служебные функции, триггеры и RPC смены статуса.
--
-- У всех функций search_path = '', поэтому имена указаны со схемой:
-- подменить таблицу или функцию через search_path нельзя.

----------------------------------------------------------------------
-- Помощники для RLS
-- security definer: читают profiles и tasks в обход RLS, поэтому политики
-- не вызывают сами себя и рекурсии нет.
----------------------------------------------------------------------

create function private.is_manager()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'manager'
  );
$$;

-- Исполнитель должен видеть имена людей из карточек своих задач:
-- автора и участников истории (там может быть и прежний исполнитель).
create function private.shares_task_with(p_profile_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.executor_id = (select auth.uid())
      and t.author_id = p_profile_id
  ) or exists (
    select 1
    from public.task_history h
    join public.tasks t on t.id = h.task_id
    where t.executor_id = (select auth.uid())
      and h.actor_id = p_profile_id
  );
$$;

----------------------------------------------------------------------
-- Триггеры таблицы tasks
----------------------------------------------------------------------

-- Новая задача создаётся только в статусе new, без исключений.
create function private.guard_task_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'new' then
    raise exception 'Задача может быть создана только в статусе «Новая»'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- security invoker намеренно: current_user здесь показывает, кто выполняет UPDATE.
-- При прямом запросе это authenticated. Внутри change_task_status это postgres,
-- так как RPC работает от имени владельца. Подделать это значение из API нельзя.
create function private.guard_task_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'postgres' then
    if new.status is distinct from old.status then
      raise exception 'Статус меняется только через change_task_status'
        using errcode = '42501';
    end if;
    if new.author_id is distinct from old.author_id
       or new.created_at is distinct from old.created_at then
      raise exception 'Автора и дату создания менять нельзя'
        using errcode = '42501';
    end if;
    if old.status = 'accepted' then
      raise exception 'Принятую задачу редактировать нельзя'
        using errcode = '42501';
    end if;
    if new.executor_id is distinct from old.executor_id and old.status = 'in_review' then
      raise exception 'Нельзя сменить исполнителя, пока задача на проверке'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- executor_id может указывать только на профиль с ролью executor.
create function private.check_task_executor()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = new.executor_id and role = 'executor'
  ) then
    raise exception 'Назначить можно только пользователя с ролью «Исполнитель»'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Запись «— -> Новая» появляется автоматически, в той же транзакции.
create function private.log_task_created()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.task_history (task_id, from_status, to_status, actor_id, created_at)
  values (new.id, null, 'new', new.author_id, new.created_at);
  return null;
end;
$$;

create trigger tasks_guard_insert
  before insert on public.tasks
  for each row execute function private.guard_task_insert();

create trigger tasks_guard_update
  before update on public.tasks
  for each row execute function private.guard_task_update();

create trigger tasks_check_executor
  before insert or update of executor_id on public.tasks
  for each row execute function private.check_task_executor();

create trigger tasks_log_created
  after insert on public.tasks
  for each row execute function private.log_task_created();

----------------------------------------------------------------------
-- Триггер таблицы profiles
----------------------------------------------------------------------

-- Защищает то же правило с другой стороны: исполнителю с назначенными задачами
-- нельзя сменить роль, иначе executor_id укажет на профиль без роли executor.
create function private.guard_profile_role_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role and exists (
    select 1 from public.tasks where executor_id = old.id
  ) then
    raise exception 'Сначала снимите с пользователя назначенные задачи'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_role_change
  before update of role on public.profiles
  for each row execute function private.guard_profile_role_change();

----------------------------------------------------------------------
-- RPC: единственный способ сменить статус задачи
----------------------------------------------------------------------

create function public.change_task_status(
  p_task_id uuid,
  p_to_status public.task_status,
  p_comment text default null
)
returns public.tasks
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_role public.user_role;
  v_task public.tasks;
  v_from_status public.task_status;
  v_required_role public.user_role;
begin
  if v_uid is null then
    raise exception 'Требуется вход в систему' using errcode = '42501';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if not found then
    raise exception 'Профиль пользователя не настроен' using errcode = '42501';
  end if;

  -- FOR UPDATE: два одновременных запроса выполнятся по очереди, и второй
  -- увидит уже новый статус.
  select * into v_task from public.tasks where id = p_task_id for update;

  -- Для чужой задачи ответ тот же, что и для несуществующей: исполнитель
  -- не должен узнавать, есть ли такая задача.
  if not found or (v_role = 'executor' and v_task.executor_id <> v_uid) then
    raise exception 'Задача не найдена' using errcode = 'P0002';
  end if;

  -- Таблица переходов. Всё, чего здесь нет, запрещено.
  v_required_role := case
    when v_task.status = 'new'         and p_to_status = 'in_progress' then 'executor'
    when v_task.status = 'in_progress' and p_to_status = 'in_review'   then 'executor'
    when v_task.status = 'rework'      and p_to_status = 'in_progress' then 'executor'
    when v_task.status = 'in_review'   and p_to_status = 'accepted'    then 'manager'
    when v_task.status = 'in_review'   and p_to_status = 'rework'      then 'manager'
  end::public.user_role;

  if v_required_role is null then
    raise exception 'Переход из статуса % в статус % запрещён', v_task.status, p_to_status
      using errcode = 'P0001';
  end if;

  -- Исполнитель уже проверен выше: чужую задачу он до этой строки не дойдёт.
  if v_role <> v_required_role then
    raise exception 'Недостаточно прав для этого перехода' using errcode = '42501';
  end if;

  if p_to_status = 'rework' and coalesce(p_comment ~ '\S', false) = false then
    raise exception 'При возврате на доработку комментарий обязателен'
      using errcode = 'P0001';
  end if;

  v_from_status := v_task.status;

  update public.tasks set status = p_to_status
  where id = p_task_id
  returning * into v_task;

  insert into public.task_history (task_id, from_status, to_status, actor_id, comment)
  values (
    p_task_id,
    v_from_status,
    p_to_status,
    v_uid,
    nullif(btrim(p_comment, E' \t\r\n'), '')
  );

  return v_task;
end;
$$;
