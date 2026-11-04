import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { env } from './env';
import {
  historySchema,
  objectSchema,
  profileSchema,
  taskSchema,
  type ObjectForm,
  type TaskForm,
  type TaskStatus,
} from './domain';

// main.tsx не загружает приложение, пока env не прошёл проверку.
export const supabase = createClient(env!.VITE_SUPABASE_URL, env!.VITE_SUPABASE_ANON_KEY);

const TASK_COLUMNS = `
  id, title, description, object_id, executor_id, author_id, status, created_at,
  object:objects(name),
  executor:profiles!tasks_executor_id_fkey(full_name),
  author:profiles!tasks_author_id_fkey(full_name)
`;

function unwrap<T>({ data, error }: { data: T; error: unknown }): T {
  if (error) throw error;
  return data;
}

export async function getProfile(userId: string) {
  const data = unwrap(
    await supabase.from('profiles').select('id, full_name, role').eq('id', userId).maybeSingle(),
  );
  return data ? profileSchema.parse(data) : null;
}

export async function listExecutors() {
  const data = unwrap(
    await supabase.from('profiles').select('id, full_name, role').eq('role', 'executor').order('full_name'),
  );
  return z.array(profileSchema).parse(data);
}

export async function listObjects() {
  const data = unwrap(await supabase.from('objects').select('id, name, address').order('name'));
  return z.array(objectSchema).parse(data);
}

export async function getObject(id: string) {
  const data = unwrap(await supabase.from('objects').select('id, name, address').eq('id', id).maybeSingle());
  return data ? objectSchema.parse(data) : null;
}

export async function createObject(values: ObjectForm) {
  unwrap(await supabase.from('objects').insert(values));
}

export async function updateObject(id: string, values: ObjectForm) {
  unwrap(await supabase.from('objects').update(values).eq('id', id));
}

export async function deleteObject(id: string) {
  unwrap(await supabase.from('objects').delete().eq('id', id));
}

// Какие задачи вернутся, решает RLS. Фильтры здесь только выбирают нужный список.
export async function listTasks(filter: { objectId?: string; executorId?: string }) {
  let query = supabase.from('tasks').select(TASK_COLUMNS).order('created_at', { ascending: false });
  if (filter.objectId) query = query.eq('object_id', filter.objectId);
  if (filter.executorId) query = query.eq('executor_id', filter.executorId);
  return z.array(taskSchema).parse(unwrap(await query));
}

export async function getTask(id: string) {
  const data = unwrap(await supabase.from('tasks').select(TASK_COLUMNS).eq('id', id).maybeSingle());
  return data ? taskSchema.parse(data) : null;
}

// Статус и автора клиент не передаёт: их задаёт база.
export async function createTask(values: TaskForm) {
  unwrap(await supabase.from('tasks').insert(values));
}

export async function updateTask(id: string, values: Partial<TaskForm>) {
  unwrap(await supabase.from('tasks').update(values).eq('id', id));
}

export async function deleteTask(id: string) {
  unwrap(await supabase.rpc('delete_task', { p_task_id: id }));
}

export async function changeTaskStatus(id: string, to: TaskStatus, comment: string) {
  unwrap(
    await supabase.rpc('change_task_status', {
      p_task_id: id,
      p_to_status: to,
      p_comment: comment || null,
    }),
  );
}

export async function getHistory(taskId: string) {
  const data = unwrap(
    await supabase
      .from('task_history')
      .select('id, from_status, to_status, comment, created_at, actor:profiles!task_history_actor_id_fkey(full_name)')
      .eq('task_id', taskId)
      .order('id'),
  );
  return z.array(historySchema).parse(data);
}
