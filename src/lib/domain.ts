import { z } from 'zod';

// Схемы строк из базы: дают и типы, и проверку ответа во время работы.

export const roleSchema = z.enum(['manager', 'executor']);
export type Role = z.infer<typeof roleSchema>;

export const statusSchema = z.enum(['new', 'in_progress', 'in_review', 'accepted', 'rework']);
export type TaskStatus = z.infer<typeof statusSchema>;

export const profileSchema = z.object({
  id: z.string(),
  full_name: z.string(),
  role: roleSchema,
});
export type Profile = z.infer<typeof profileSchema>;

export const objectSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string(),
});
export type SiteObject = z.infer<typeof objectSchema>;

const personSchema = z.object({ full_name: z.string() }).nullable();

export const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  object_id: z.string(),
  executor_id: z.string(),
  author_id: z.string(),
  status: statusSchema,
  created_at: z.string(),
  object: z.object({ name: z.string() }).nullable(),
  executor: personSchema,
  author: personSchema,
});
export type Task = z.infer<typeof taskSchema>;

export const historySchema = z.object({
  id: z.number(),
  from_status: statusSchema.nullable(),
  to_status: statusSchema,
  comment: z.string().nullable(),
  created_at: z.string(),
  actor: personSchema,
});
export type HistoryEntry = z.infer<typeof historySchema>;

export const STATUS_LABELS: Record<TaskStatus, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  in_review: 'На проверке',
  accepted: 'Принята',
  rework: 'На доработке',
};

export const STATUS_COLORS: Record<TaskStatus, string> = {
  new: 'blue',
  in_progress: 'yellow',
  in_review: 'violet',
  accepted: 'green',
  rework: 'red',
};

export const ROLE_LABELS: Record<Role, string> = {
  manager: 'Постановщик',
  executor: 'Исполнитель',
};

export interface Transition {
  from: TaskStatus;
  to: TaskStatus;
  role: Role;
  label: string;
  commentRequired: boolean;
}

// Только для показа кнопок. Настоящая проверка находится в change_task_status.
const TRANSITIONS: Transition[] = [
  { from: 'new', to: 'in_progress', role: 'executor', label: 'Взять в работу', commentRequired: false },
  { from: 'in_progress', to: 'in_review', role: 'executor', label: 'Отправить на проверку', commentRequired: false },
  { from: 'rework', to: 'in_progress', role: 'executor', label: 'Взять в работу', commentRequired: false },
  { from: 'in_review', to: 'accepted', role: 'manager', label: 'Принять', commentRequired: false },
  { from: 'in_review', to: 'rework', role: 'manager', label: 'Вернуть на доработку', commentRequired: true },
];

export function availableTransitions(task: Task, profile: Profile): Transition[] {
  if (profile.role === 'executor' && task.executor_id !== profile.id) return [];
  return TRANSITIONS.filter((t) => t.from === task.status && t.role === profile.role);
}

// Те же правила, что в триггере guard_task_update: так интерфейс не предлагает
// заведомо отклоняемое действие.
export const canEditTask = (task: Task) => task.status !== 'accepted';
export const canChangeExecutor = (task: Task) =>
  task.status !== 'accepted' && task.status !== 'in_review';

// Формы

const required = (max: number) =>
  z.string().trim().min(1, 'Заполните поле').max(max, `Не больше ${max} символов`);

export const loginFormSchema = z.object({
  email: z.string().trim().email('Введите корректный email'),
  password: z.string().min(1, 'Введите пароль'),
});

export const objectFormSchema = z.object({
  name: required(200),
  address: required(500),
});
export type ObjectForm = z.infer<typeof objectFormSchema>;

export const taskFormSchema = z.object({
  title: required(200),
  description: z.string().trim().max(5000, 'Не больше 5000 символов'),
  object_id: z.string().min(1, 'Выберите объект'),
  executor_id: z.string().min(1, 'Выберите исполнителя'),
});
export type TaskForm = z.infer<typeof taskFormSchema>;

export const commentSchema = (isRequired: boolean) =>
  z.object({
    comment: isRequired
      ? required(2000)
      : z.string().trim().max(2000, 'Не больше 2000 символов'),
  });

export function zodValidate<T>(schema: z.ZodType<unknown, T>) {
  return (values: T) => {
    const result = schema.safeParse(values);
    if (result.success) return {};
    return Object.fromEntries(result.error.issues.map((i) => [i.path.join('.'), i.message]));
  };
}

export const formatDateTime = (value: string) =>
  new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
