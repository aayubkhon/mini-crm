-- Ответ работодателя: исполнителя можно сменить в любой момент и в любом статусе,
-- включая «На проверке» и «Принята». Статус при этом не меняется.
--
-- Меняется только триггерная функция. Все остальные запреты остаются прежними,
-- принятую задачу по-прежнему нельзя редактировать: название, описание, объект.
-- create or replace сохраняет владельца, права и привязку к триггеру tasks_guard_update.

create or replace function private.guard_task_update()
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
    if new.deleted_at is distinct from old.deleted_at then
      raise exception 'Задача удаляется только через delete_task'
        using errcode = '42501';
    end if;
    if new.author_id is distinct from old.author_id
       or new.created_at is distinct from old.created_at then
      raise exception 'Автора и дату создания менять нельзя'
        using errcode = '42501';
    end if;
    if old.status = 'accepted' and (
      new.title is distinct from old.title
      or new.description is distinct from old.description
      or new.object_id is distinct from old.object_id
    ) then
      raise exception 'В принятой задаче можно сменить только исполнителя'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
