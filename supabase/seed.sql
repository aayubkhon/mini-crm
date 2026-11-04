-- Демо-данные. Запускать после миграций и после создания трёх пользователей
-- в Dashboard: Authentication -> Users -> Add user (с галочкой Auto Confirm):
--   manager@example.com, executor.a@example.com, executor.b@example.com
--
-- UUID копировать не нужно: они берутся из auth.users по email.
-- Скрипт можно запускать повторно: демо-задачи и объекты создаются заново.
--
-- Статусы меняются настоящей функцией change_task_status от имени нужного
-- пользователя, поэтому демо-история прошла те же проверки, что и обычная.

create function pg_temp.seed_move(
  p_task uuid,
  p_actor uuid,
  p_to public.task_status,
  p_comment text default null
) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_actor)::text, true);
  perform public.change_task_status(p_task, p_to, p_comment);
end;
$$;

do $$
declare
  v_manager    uuid := (select id from auth.users where email = 'manager@example.com');
  v_executor_a uuid := (select id from auth.users where email = 'executor.a@example.com');
  v_executor_b uuid := (select id from auth.users where email = 'executor.b@example.com');

  o_north constant uuid := '00000000-0000-4000-a000-000000000001';
  o_merid constant uuid := '00000000-0000-4000-a000-000000000002';
  o_store constant uuid := '00000000-0000-4000-a000-000000000003';

  t_new_a      constant uuid := '00000000-0000-4000-b000-000000000001';
  t_work_a     constant uuid := '00000000-0000-4000-b000-000000000002';
  t_review_a   constant uuid := '00000000-0000-4000-b000-000000000003';
  t_accepted_a constant uuid := '00000000-0000-4000-b000-000000000004';
  t_rework_b   constant uuid := '00000000-0000-4000-b000-000000000005';
  t_work_b     constant uuid := '00000000-0000-4000-b000-000000000006';
  t_new_b      constant uuid := '00000000-0000-4000-b000-000000000007';
begin
  if v_manager is null or v_executor_a is null or v_executor_b is null then
    raise exception 'Сначала создайте в Dashboard пользователей: manager@example.com, executor.a@example.com, executor.b@example.com';
  end if;

  -- Очистка предыдущего запуска. История удалится каскадом.
  delete from public.tasks
  where object_id in (o_north, o_merid, o_store)
     or id in (t_new_a, t_work_a, t_review_a, t_accepted_a, t_rework_b, t_work_b, t_new_b);
  delete from public.objects where id in (o_north, o_merid, o_store);

  insert into public.profiles (id, full_name, role) values
    (v_manager,    'Ирина Постановщик', 'manager'),
    (v_executor_a, 'Алексей Исполнитель', 'executor'),
    (v_executor_b, 'Борис Исполнитель', 'executor')
  on conflict (id) do update
    set full_name = excluded.full_name, role = excluded.role;

  insert into public.objects (id, name, address) values
    (o_north, 'ЖК «Северный»',       'г. Москва, ул. Лесная, 12'),
    (o_merid, 'БЦ «Меридиан»',       'г. Москва, пр-т Мира, 45'),
    (o_store, 'Склад «Логистик-Парк»', 'Московская обл., промзона Южная, 3');

  -- ЖК «Северный» содержит задачи обоих исполнителей: каждый видит только свои.
  -- БЦ «Меридиан» виден только исполнителю A, склад только исполнителю B.
  insert into public.tasks (id, title, description, object_id, executor_id, author_id, created_at) values
    (t_new_a,      'Проверить опалубку',            'Секция 1, перед заливкой плиты.',          o_north, v_executor_a, v_manager, now() - interval '1 day'),
    (t_work_a,     'Армирование плиты перекрытия',  'Секция 1, этаж 4, по проекту КЖ-12.',      o_north, v_executor_a, v_manager, now() - interval '3 days'),
    (t_review_a,   'Монтаж вентиляции',             'Этаж 3, приточная система П-2.',           o_merid, v_executor_a, v_manager, now() - interval '5 days'),
    (t_accepted_a, 'Устройство стяжки пола',        'Этаж 2, холл и коридоры.',                 o_merid, v_executor_a, v_manager, now() - interval '8 days'),
    (t_rework_b,   'Штукатурка стен',               'Секция 2, этаж 5, машинное нанесение.',    o_north, v_executor_b, v_manager, now() - interval '6 days'),
    (t_work_b,     'Монтаж стеллажей',              'Зона хранения А, ряды 1-10.',              o_store, v_executor_b, v_manager, now() - interval '2 days'),
    (t_new_b,      'Разметка парковки',             'Территория у ворот 2.',                    o_store, v_executor_b, v_manager, now() - interval '12 hours');

  perform pg_temp.seed_move(t_work_a, v_executor_a, 'in_progress');

  perform pg_temp.seed_move(t_review_a, v_executor_a, 'in_progress');
  perform pg_temp.seed_move(t_review_a, v_executor_a, 'in_review', 'Монтаж завершён, система запущена.');

  perform pg_temp.seed_move(t_accepted_a, v_executor_a, 'in_progress');
  perform pg_temp.seed_move(t_accepted_a, v_executor_a, 'in_review');
  perform pg_temp.seed_move(t_accepted_a, v_manager,    'accepted', 'Ровность в норме, принято.');

  perform pg_temp.seed_move(t_rework_b, v_executor_b, 'in_progress');
  perform pg_temp.seed_move(t_rework_b, v_executor_b, 'in_review');
  perform pg_temp.seed_move(t_rework_b, v_manager,    'rework', 'Трещины у оконных откосов, нужно исправить.');

  perform pg_temp.seed_move(t_work_b, v_executor_b, 'in_progress');

  -- В одной транзакции now() не меняется, поэтому разносим записи по времени,
  -- чтобы демо-история выглядела реалистично.
  update public.task_history h
  set created_at = t.created_at + (s.step * interval '4 hours')
  from public.tasks t,
       (select id, row_number() over (partition by task_id order by id) - 1 as step
        from public.task_history) s
  where h.task_id = t.id
    and s.id = h.id
    and t.id in (t_new_a, t_work_a, t_review_a, t_accepted_a, t_rework_b, t_work_b, t_new_b);

  perform set_config('request.jwt.claims', '', true);
end;
$$;

drop function pg_temp.seed_move(uuid, uuid, public.task_status, text);
