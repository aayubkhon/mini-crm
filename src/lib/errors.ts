const FALLBACK = 'Не удалось выполнить действие. Попробуйте ещё раз.';

const BY_CODE: Record<string, string> = {
  '42501': 'Недостаточно прав для этого действия.',
  '22P02': 'Запись не найдена.',
  '23514': 'Данные не прошли проверку. Проверьте заполнение полей.',
  // До PostgreSQL 18 on delete restrict отвечает кодом 23503, начиная с 18 кодом 23001.
  '23503': 'Запись нельзя удалить: с ней связаны другие данные.',
  '23001': 'Запись нельзя удалить: с ней связаны другие данные.',
};

// Сообщения из наших функций уже на русском, их показываем как есть.
// Технические ответы базы пользователю не показываем.
export function errorMessage(error: unknown): string {
  if (typeof error !== 'object' || error === null) return FALLBACK;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof message === 'string' && /[А-Яа-яЁё]/.test(message)) return message;
  if (typeof code === 'string' && BY_CODE[code]) return BY_CODE[code];
  return FALLBACK;
}

export function deleteObjectErrorMessage(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === '23503' || code === '23001') {
    return 'Объект нельзя удалить: в нём есть или были задачи, в том числе удалённые.';
  }
  return errorMessage(error);
}
