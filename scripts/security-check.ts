// npm run check:security            только показать результат
// npm run check:security -- --readme  ещё и записать таблицу в README.md
//
// Проверяет защиту так, как её обошёл бы злоумышленник: прямыми запросами через
// supabase-js, без интерфейса и только с публичным ключом. Ключ service_role не нужен.
//
// Что остаётся в базе после запуска:
//   - задачи, созданные проверкой, удаляются мягко (физически их удалить нельзя);
//   - один служебный объект OBJECT_NAME: у него были задачи, поэтому удалить его нельзя.
//     При следующем запуске он используется повторно. Как его убрать, описано в README.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

const envResult = z
  .object({
    VITE_SUPABASE_URL: z.url(),
    VITE_SUPABASE_ANON_KEY: z.string().min(1),
    CHECK_MANAGER_EMAIL: z.string().min(1),
    CHECK_MANAGER_PASSWORD: z.string().min(1),
    CHECK_EXECUTOR_A_EMAIL: z.string().min(1),
    CHECK_EXECUTOR_A_PASSWORD: z.string().min(1),
    CHECK_EXECUTOR_B_EMAIL: z.string().min(1),
    CHECK_EXECUTOR_B_PASSWORD: z.string().min(1),
  })
  .safeParse(process.env);

if (!envResult.success) {
  const names = envResult.error.issues.map((i) => i.path.join('.')).join(', ');
  console.error(`Заполните в .env.local: ${names} (образец: .env.example)`);
  process.exit(2);
}
const env = envResult.data;

const OBJECT_NAME = '[security-check] служебный объект';
const MISSING_ID = '00000000-0000-4000-b000-0000000000ff';
const TASK_PREFIX = '[security-check]';
const STATUSES = ['new', 'in_progress', 'in_review', 'accepted', 'rework'] as const;
type Status = (typeof STATUSES)[number];

const newClient = () =>
  createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

async function signIn(email: string, password: string, label: string) {
  const client = newClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    console.error(`Не удалось войти как ${label}: ${error?.message ?? 'нет пользователя'}`);
    process.exit(2);
  }
  return { client, id: data.user.id };
}

interface Result {
  group: string;
  name: string;
  ok: boolean;
  detail: string;
}
const results: Result[] = [];
let group = '';

function record(name: string, ok: boolean, detail: string) {
  results.push({ group, name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${detail}`}`);
}

// Ошибка от базы: действие отклонено.
const rejected = (r: { error: unknown }) => r.error !== null;
const errCode = (r: { error: { code?: string } | null }) => r.error?.code ?? 'нет ошибки';

const manager = await signIn(env.CHECK_MANAGER_EMAIL, env.CHECK_MANAGER_PASSWORD, 'постановщик');
const execA = await signIn(env.CHECK_EXECUTOR_A_EMAIL, env.CHECK_EXECUTOR_A_PASSWORD, 'исполнитель A');
const execB = await signIn(env.CHECK_EXECUTOR_B_EMAIL, env.CHECK_EXECUTOR_B_PASSWORD, 'исполнитель B');
const anon = newClient();

const createdTaskIds: string[] = [];

async function ensureServiceObject(): Promise<string> {
  const found = await manager.client.from('objects').select('id').eq('name', OBJECT_NAME).maybeSingle();
  if (found.error) throw found.error;
  if (found.data) return found.data.id as string;
  const created = await manager.client
    .from('objects')
    .insert({ name: OBJECT_NAME, address: 'Создан npm run check:security' })
    .select('id')
    .single();
  if (created.error) throw created.error;
  return created.data.id as string;
}

async function createTask(objectId: string, executorId: string, suffix: string): Promise<string> {
  const { data, error } = await manager.client
    .from('tasks')
    .insert({ title: `${TASK_PREFIX} ${suffix}`, object_id: objectId, executor_id: executorId })
    .select('id')
    .single();
  if (error) throw error;
  createdTaskIds.push(data.id as string);
  return data.id as string;
}

const move = (client: SupabaseClient, id: string, to: Status, comment?: string | null) =>
  client.rpc('change_task_status', { p_task_id: id, p_to_status: to, p_comment: comment ?? null });

async function mustMove(client: SupabaseClient, id: string, to: Status, comment?: string) {
  const r = await move(client, id, to, comment);
  if (r.error) throw new Error(`Разрешённый переход в ${to} не прошёл: ${r.error.message}`);
}

// Статус читает постановщик: он видит все действующие задачи.
async function statusOf(id: string): Promise<string | null> {
  const r = await manager.client.from('tasks').select('status').eq('id', id).maybeSingle();
  return (r.data?.status as string | undefined) ?? null;
}

// Смена исполнителя с A на B в заданном статусе и возврат обратно.
async function checkReassign(taskId: string, status: Status, label: string) {
  const countHistory = async () =>
    (await manager.client.from('task_history').select('id').eq('task_id', taskId)).data?.length;
  const historyBefore = await countHistory();

  const toManager = await manager.client.from('tasks').update({ executor_id: manager.id }).eq('id', taskId);
  record(`${label}: назначить постановщика исполнителем нельзя`, toManager.error?.code === '23514', errCode(toManager));

  const selfMove = await execA.client.from('tasks').update({ executor_id: execB.id }).eq('id', taskId).select('id');
  const stillA = await manager.client.from('tasks').select('executor_id').eq('id', taskId).single();
  record(
    `${label}: исполнитель сам не передаёт задачу`,
    (selfMove.data?.length ?? 0) === 0 && stillA.data?.executor_id === execA.id,
    `исполнитель: ${stillA.data?.executor_id}`,
  );

  const toB = await manager.client.from('tasks').update({ executor_id: execB.id }).eq('id', taskId).select('id');
  const seenByA = await execA.client.from('tasks').select('id').eq('id', taskId);
  const seenByB = await execB.client.from('tasks').select('id').eq('id', taskId);
  const aHistory = await execA.client.from('task_history').select('id').eq('task_id', taskId);
  const bHistory = await execB.client.from('task_history').select('id').eq('task_id', taskId);
  record(`${label}: постановщик меняет исполнителя`, !toB.error && toB.data?.length === 1, errCode(toB));
  record(`${label}: статус при смене не изменился`, (await statusOf(taskId)) === status, String(await statusOf(taskId)));
  record(`${label}: смена не добавляет запись в историю`, (await countHistory()) === historyBefore, `${historyBefore} -> ${await countHistory()}`);
  record(
    `${label}: прежний исполнитель теряет доступ, новый получает вместе с историей`,
    seenByA.data?.length === 0 &&
      aHistory.data?.length === 0 &&
      seenByB.data?.length === 1 &&
      bHistory.data?.length === historyBefore,
    `A: ${seenByA.data?.length}/${aHistory.data?.length}, B: ${seenByB.data?.length}/${bHistory.data?.length}`,
  );

  const back = await manager.client.from('tasks').update({ executor_id: execA.id }).eq('id', taskId);
  if (back.error) throw back.error;
}

async function run() {
  const objectId = await ensureServiceObject();
  const taskA = await createTask(objectId, execA.id, 'задача исполнителя A');
  const titleA = `${TASK_PREFIX} задача исполнителя A`;

  group = 'Анонимный доступ';
  for (const table of ['profiles', 'objects', 'tasks', 'task_history']) {
    const r = await anon.from(table).select('*');
    record(`anon не читает ${table}`, rejected(r) || (r.data?.length ?? 0) === 0, `строк: ${r.data?.length}`);
  }
  const anonRpc = await move(anon, taskA, 'in_progress');
  record('anon не вызывает change_task_status', rejected(anonRpc), errCode(anonRpc));
  const anonDel = await anon.rpc('delete_task', { p_task_id: taskA });
  record('anon не вызывает delete_task', rejected(anonDel), errCode(anonDel));
  const anonInsert = await anon.from('objects').insert({ name: 'x', address: 'x' });
  record('anon не создаёт объект', rejected(anonInsert), errCode(anonInsert));

  group = 'Регистрация';
  const signUp = await newClient().auth.signUp({
    email: `security-check-${Date.now()}@example.com`,
    password: `Check-${Date.now()}-password`,
  });
  record(
    'signUp возвращает ошибку',
    signUp.error !== null,
    signUp.data.user ? `создан пользователь ${signUp.data.user.email}: регистрация включена!` : 'нет ошибки',
  );

  group = 'Чужая задача (исполнитель B и задача исполнителя A)';
  const bRead = await execB.client.from('tasks').select('id').eq('id', taskA);
  record('B не видит задачу A', !bRead.error && bRead.data.length === 0, `строк: ${bRead.data?.length}`);
  const bHist = await execB.client.from('task_history').select('id').eq('task_id', taskA);
  record('B не видит историю задачи A', !bHist.error && bHist.data.length === 0, `строк: ${bHist.data?.length}`);
  const bUpdate = await execB.client.from('tasks').update({ title: 'взлом' }).eq('id', taskA).select('id');
  const titleNow = await manager.client.from('tasks').select('title').eq('id', taskA).single();
  record(
    'B не изменяет задачу A',
    (bUpdate.data?.length ?? 0) === 0 && titleNow.data?.title === titleA,
    `название: ${titleNow.data?.title}`,
  );
  const bDelete = await execB.client.from('tasks').delete().eq('id', taskA);
  const bDeleteRpc = await execB.client.rpc('delete_task', { p_task_id: taskA });
  record(
    'B не удаляет задачу A (ни DELETE, ни delete_task)',
    rejected(bDelete) && rejected(bDeleteRpc) && (await statusOf(taskA)) === 'new',
    `${errCode(bDelete)} / ${errCode(bDeleteRpc)}`,
  );
  const bTake = await move(execB.client, taskA, 'in_progress');
  record('B не берёт задачу A в работу', rejected(bTake) && (await statusOf(taskA)) === 'new', errCode(bTake));
  const bMissing = await move(execB.client, MISSING_ID, 'in_progress');
  record(
    'Ответ на чужую задачу не отличается от ответа на несуществующую',
    bTake.error?.message === bMissing.error?.message && bTake.error?.code === bMissing.error?.code,
    `${bTake.error?.message} / ${bMissing.error?.message}`,
  );

  group = 'Прямое изменение защищённых колонок';
  for (const [who, client] of [['Постановщик', manager.client], ['Исполнитель A', execA.client]] as const) {
    const r = await client.from('tasks').update({ status: 'accepted' }).eq('id', taskA);
    record(`${who}: прямой UPDATE status отклонён`, r.error?.code === '42501', errCode(r));
  }
  const directDeleted = await manager.client.from('tasks').update({ deleted_at: new Date().toISOString() }).eq('id', taskA);
  record('Прямой UPDATE deleted_at отклонён', directDeleted.error?.code === '42501', errCode(directDeleted));
  const directAuthor = await manager.client.from('tasks').update({ author_id: execA.id }).eq('id', taskA);
  record('Прямой UPDATE author_id отклонён', directAuthor.error?.code === '42501', errCode(directAuthor));
  record('После этих попыток статус задачи не изменился', (await statusOf(taskA)) === 'new', String(await statusOf(taskA)));

  group = 'Создание задач';
  const execInsert = await execA.client.from('tasks').insert({ title: 'x', object_id: objectId, executor_id: execA.id });
  record('Исполнитель не создаёт задачу', rejected(execInsert), errCode(execInsert));
  const withStatus = await manager.client
    .from('tasks')
    .insert({ title: 'x', object_id: objectId, executor_id: execA.id, status: 'accepted' });
  record('Постановщик не создаёт задачу сразу со статусом «Принята»', withStatus.error?.code === '42501', errCode(withStatus));
  const withAuthor = await manager.client
    .from('tasks')
    .insert({ title: 'x', object_id: objectId, executor_id: execA.id, author_id: execA.id });
  record('Автора нельзя подделать', withAuthor.error?.code === '42501', errCode(withAuthor));
  const managerAsExecutor = await manager.client
    .from('tasks')
    .insert({ title: 'x', object_id: objectId, executor_id: manager.id });
  record('Нельзя назначить исполнителем постановщика', managerAsExecutor.error?.code === '23514', errCode(managerAsExecutor));
  const fresh = await manager.client.from('tasks').select('status, author_id').eq('id', taskA).single();
  const freshHist = await manager.client.from('task_history').select('from_status, to_status, actor_id').eq('task_id', taskA);
  record(
    'Новая задача: статус «Новая», автор из сессии, запись истории «— -> Новая»',
    fresh.data?.status === 'new' &&
      fresh.data?.author_id === manager.id &&
      freshHist.data?.length === 1 &&
      freshHist.data[0].from_status === null &&
      freshHist.data[0].to_status === 'new' &&
      freshHist.data[0].actor_id === manager.id,
    JSON.stringify({ task: fresh.data, history: freshHist.data }),
  );

  group = 'Переходы статусов';
  const allowed: Record<string, 'manager' | 'executor'> = {
    'new>in_progress': 'executor',
    'in_progress>in_review': 'executor',
    'rework>in_progress': 'executor',
    'in_review>accepted': 'manager',
    'in_review>rework': 'manager',
  };
  // Перебор всех сочетаний «статус, целевой статус, роль», кроме пяти разрешённых.
  // Комментарий передаётся, чтобы отказ был именно из-за перехода.
  const sweep = async (status: Status, id: string) => {
    const leaked: string[] = [];
    let tried = 0;
    for (const to of STATUSES) {
      for (const [role, client] of [['manager', manager.client], ['executor', execA.client]] as const) {
        if (allowed[`${status}>${to}`] === role) continue;
        tried++;
        const r = await move(client, id, to, 'проверка');
        if (!r.error || (await statusOf(id)) !== status) leaked.push(`${status}>${to} (${role})`);
      }
    }
    record(`Из «${status}»: все ${tried} запрещённых вариантов отклонены через RPC`, leaked.length === 0, leaked.join(', '));
  };

  await sweep('new', taskA);
  await mustMove(execA.client, taskA, 'in_progress');
  await sweep('in_progress', taskA);
  await mustMove(execA.client, taskA, 'in_review');
  await sweep('in_review', taskA);

  group = 'Комментарий при возврате на доработку';
  for (const [label, comment] of [['null', null], ['пустая строка', ''], ['пробелы', '   '], ['перевод строки', '\n\t ']] as const) {
    const r = await move(manager.client, taskA, 'rework', comment);
    record(`«На доработке» без комментария отклонено: ${label}`, rejected(r) && (await statusOf(taskA)) === 'in_review', errCode(r));
  }

  group = 'Разрешённые переходы и история';
  await checkReassign(taskA, 'in_review', 'На проверке');
  await mustMove(manager.client, taskA, 'rework', 'Нужно исправить');
  await sweep('rework', taskA);
  await mustMove(execA.client, taskA, 'in_progress');
  await mustMove(execA.client, taskA, 'in_review');
  await mustMove(manager.client, taskA, 'accepted');
  await sweep('accepted', taskA);
  for (const [label, change] of [
    ['название', { title: 'правка' }],
    ['описание', { description: 'правка' }],
  ] as const) {
    const r = await manager.client.from('tasks').update(change).eq('id', taskA).select('id');
    record(`Принятая задача: ${label} менять нельзя`, r.error?.code === '42501', errCode(r));
  }
  await checkReassign(taskA, 'accepted', 'Принята');

  const chain = await execA.client
    .from('task_history')
    .select('from_status, to_status, actor_id, comment')
    .eq('task_id', taskA)
    .order('id');
  const expected = [
    [null, 'new', manager.id],
    ['new', 'in_progress', execA.id],
    ['in_progress', 'in_review', execA.id],
    ['in_review', 'rework', manager.id],
    ['rework', 'in_progress', execA.id],
    ['in_progress', 'in_review', execA.id],
    ['in_review', 'accepted', manager.id],
  ];
  record(
    'История полная и верная: кто, из какого статуса, в какой, комментарий',
    JSON.stringify(chain.data?.map((h) => [h.from_status, h.to_status, h.actor_id])) === JSON.stringify(expected) &&
      chain.data?.[3].comment === 'Нужно исправить',
    JSON.stringify(chain.data),
  );

  group = 'task_history только для чтения';
  const historyRow = chain.data![0];
  const historyIds = await manager.client.from('task_history').select('id').eq('task_id', taskA);
  const historyId = historyIds.data![0].id as number;
  for (const [who, client, uid] of [['Постановщик', manager.client, manager.id], ['Исполнитель A', execA.client, execA.id]] as const) {
    const ins = await client.from('task_history').insert({ task_id: taskA, to_status: 'new', actor_id: uid });
    record(`${who}: INSERT в task_history отклонён`, ins.error?.code === '42501', errCode(ins));
    const upd = await client.from('task_history').update({ comment: 'подделка' }).eq('id', historyId);
    record(`${who}: UPDATE task_history отклонён`, upd.error?.code === '42501', errCode(upd));
    const del = await client.from('task_history').delete().eq('id', historyId);
    record(`${who}: DELETE из task_history отклонён`, del.error?.code === '42501', errCode(del));
  }
  const historyAfter = await manager.client.from('task_history').select('comment, to_status').eq('id', historyId).single();
  record(
    'Запись истории осталась без изменений',
    historyAfter.data?.to_status === historyRow.to_status && historyAfter.data?.comment === historyRow.comment,
    JSON.stringify(historyAfter.data),
  );

  group = 'Роли';
  for (const [who, { client, id }] of [['Постановщик', manager], ['Исполнитель A', execA]] as const) {
    const up = await client.from('profiles').update({ role: 'manager' }).eq('id', id);
    record(`${who}: сменить profiles.role нельзя`, up.error?.code === '42501', errCode(up));
    const ins = await client.from('profiles').insert({ id: MISSING_ID, full_name: 'x', role: 'manager' });
    record(`${who}: создать профиль нельзя`, ins.error?.code === '42501', errCode(ins));
  }
  const ownRole = await execA.client.from('profiles').select('role').eq('id', execA.id).single();
  record('Роль исполнителя A не изменилась', ownRole.data?.role === 'executor', String(ownRole.data?.role));

  const metadata = await execA.client.auth.updateUser({ data: { role: 'manager' } });
  try {
    const asManager = await execA.client.from('objects').insert({ name: 'x', address: 'x' });
    record(
      'role: manager в user_metadata не даёт прав постановщика',
      !metadata.error && rejected(asManager),
      `${metadata.error?.message ?? 'metadata обновлены'} / ${errCode(asManager)}`,
    );
  } finally {
    await execA.client.auth.updateUser({ data: { role: null } });
  }

  const hidden = await execA.client.rpc('is_manager');
  record('Служебная функция is_manager недоступна как RPC', rejected(hidden), errCode(hidden));
  // Постановщик мог переназначить задачу с A на B, тогда B законно видит имя A в истории.
  const bTasks = await manager.client.from('tasks').select('id, author_id').eq('executor_id', execB.id);
  const bTaskIds = (bTasks.data ?? []).map((t) => t.id as string);
  const sharedHistory = await manager.client
    .from('task_history')
    .select('id')
    .in('task_id', bTaskIds)
    .eq('actor_id', execA.id);
  const expectedVisible = (sharedHistory.data?.length ?? 0) > 0 ? 1 : 0;
  const bProfiles = await execB.client.from('profiles').select('id').eq('id', execA.id);
  record(
    'Исполнитель видит профиль другого исполнителя, только если у них есть общая задача',
    bProfiles.data?.length === expectedVisible,
    `строк: ${bProfiles.data?.length}, ожидалось: ${expectedVisible}`,
  );

  group = 'Одновременные запросы';
  const taskC = await createTask(objectId, execA.id, 'задача для гонки');
  const race = await Promise.all(Array.from({ length: 8 }, () => move(execA.client, taskC, 'in_progress')));
  const raceHist = await manager.client
    .from('task_history')
    .select('id')
    .eq('task_id', taskC)
    .eq('to_status', 'in_progress');
  const raceWins = race.filter((r) => !r.error).length;
  record(
    '8 одновременных одинаковых переходов: проходит один, в истории одна запись',
    raceWins === 1 && raceHist.data?.length === 1,
    `успешно: ${raceWins}, записей: ${raceHist.data?.length}`,
  );
  await manager.client.rpc('delete_task', { p_task_id: taskC });

  group = 'Мягкое удаление';
  const taskD = await createTask(objectId, execA.id, 'задача на удаление');
  const seenObject = await execA.client.from('objects').select('id').eq('id', objectId);
  record('Исполнитель видит объект, пока на нём есть его задача', seenObject.data?.length === 1, `строк: ${seenObject.data?.length}`);
  const notSeenObject = await execB.client.from('objects').select('id').eq('id', objectId);
  record('Другой исполнитель этот объект не видит', notSeenObject.data?.length === 0, `строк: ${notSeenObject.data?.length}`);
  const ownDelete = await execA.client.rpc('delete_task', { p_task_id: taskD });
  record('Исполнитель не удаляет свою задачу', ownDelete.error?.code === '42501', errCode(ownDelete));
  const directDelete = await manager.client.from('tasks').delete().eq('id', taskD);
  record('Постановщик: прямой DELETE задачи отклонён', directDelete.error?.code === '42501', errCode(directDelete));

  const softDelete = await manager.client.rpc('delete_task', { p_task_id: taskD });
  record('Постановщик удаляет задачу через delete_task', !softDelete.error, errCode(softDelete));
  const accDelete = await manager.client.rpc('delete_task', { p_task_id: taskA });
  record('Постановщик может удалить и принятую задачу', !accDelete.error, errCode(accDelete));
  const again = await manager.client.rpc('delete_task', { p_task_id: taskD });
  record('Повторное удаление отклонено', rejected(again), errCode(again));

  const mTask = await manager.client.from('tasks').select('id').in('id', [taskD, taskA]);
  const aTask = await execA.client.from('tasks').select('id').in('id', [taskD, taskA]);
  record('Удалённая задача не видна никому', mTask.data?.length === 0 && aTask.data?.length === 0, `${mTask.data?.length} / ${aTask.data?.length}`);
  const mHist = await manager.client.from('task_history').select('id').in('task_id', [taskD, taskA]);
  const aHist = await execA.client.from('task_history').select('id').in('task_id', [taskD, taskA]);
  record('История удалённой задачи скрыта через API', mHist.data?.length === 0 && aHist.data?.length === 0, `${mHist.data?.length} / ${aHist.data?.length}`);
  const deadMove = await move(execA.client, taskD, 'in_progress');
  record('Сменить статус удалённой задачи нельзя', rejected(deadMove), errCode(deadMove));
  const deadEdit = await manager.client.from('tasks').update({ title: 'правка' }).eq('id', taskD).select('id');
  record('Редактировать удалённую задачу нельзя', deadEdit.data?.length === 0, `строк: ${deadEdit.data?.length}`);
  const gone = await execA.client.from('objects').select('id').eq('id', objectId);
  record('Исполнитель больше не видит объект, где у него только удалённые задачи', gone.data?.length === 0, `строк: ${gone.data?.length}`);

  group = 'Удаление объектов';
  const objectDelete = await manager.client.from('objects').delete().eq('id', objectId).select('id');
  const stillThere = await manager.client.from('objects').select('id').eq('id', objectId);
  record(
    'Объект, где остались только удалённые задачи, удалить нельзя',
    ['23001', '23503'].includes(objectDelete.error?.code ?? '') && stillThere.data?.length === 1,
    errCode(objectDelete),
  );
  const empty = await manager.client
    .from('objects')
    .insert({ name: `${TASK_PREFIX} пустой объект`, address: 'x' })
    .select('id')
    .single();
  const emptyDelete = await manager.client.from('objects').delete().eq('id', empty.data!.id).select('id');
  record('Объект без задач удаляется', emptyDelete.data?.length === 1, errCode(emptyDelete));
  const execObjectDelete = await execA.client.from('objects').delete().eq('id', objectId).select('id');
  record('Исполнитель не удаляет объект', (execObjectDelete.data?.length ?? 0) === 0, `строк: ${execObjectDelete.data?.length}`);

  return { deletedTask: taskA };
}

const startedAt = new Date();
let crash: unknown = null;
let deletedTask: string | undefined;
try {
  ({ deletedTask } = await run());
} catch (error) {
  crash = error;
} finally {
  // Не оставляем действующих задач даже после сбоя.
  for (const id of createdTaskIds) await manager.client.rpc('delete_task', { p_task_id: id });
  await Promise.all([manager, execA, execB].map(({ client }) => client.auth.signOut()));
}

const failed = results.filter((r) => !r.ok);
console.log(`\nПройдено: ${results.length - failed.length} из ${results.length}`);

if (crash) {
  console.error('Проверка прервана:', crash);
  process.exit(2);
}

if (deletedTask) {
  console.log(
    '\nЧерез API историю удалённой задачи никто не видит, поэтому сохранность проверяется в SQL Editor:\n' +
      `  select count(*) from task_history where task_id = '${deletedTask}';  -- ожидается 7`,
  );
}

function markdownTable() {
  const isLocal = /127\.0\.0\.1|localhost/.test(env.VITE_SUPABASE_URL);
  const lines = [
    `Запуск: ${startedAt.toISOString().slice(0, 10)}, ${isLocal ? 'локальный стек Supabase' : 'облачный проект Supabase'}. ` +
      `Пройдено ${results.length - failed.length} из ${results.length}.`,
    '',
    '| Группа | Проверка | Результат |',
    '|---|---|---|',
    ...results.map((r) => `| ${r.group} | ${r.name.replaceAll('|', '/')} | ${r.ok ? '✅' : `❌ ${r.detail.replaceAll('|', '/')}`} |`),
  ];
  return lines.join('\n');
}

if (process.argv.includes('--readme')) {
  const start = '<!-- security-check:start -->';
  const end = '<!-- security-check:end -->';
  const readme = readFileSync('README.md', 'utf8');
  if (!readme.includes(start) || !readme.includes(end)) {
    console.error('В README.md нет меток security-check');
    process.exit(2);
  }
  const updated = readme.replace(
    new RegExp(`${start}[\\s\\S]*${end}`),
    () => `${start}\n${markdownTable()}\n${end}`,
  );
  writeFileSync('README.md', updated);
  console.log('\nТаблица записана в README.md');
}

process.exit(failed.length ? 1 : 0);
