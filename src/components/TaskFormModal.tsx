import { useState } from 'react';
import { useForm } from '@mantine/form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Group, Modal, Select, Stack, Textarea, TextInput } from '@mantine/core';
import { createTask, listExecutors, listObjects, updateTask } from '../lib/api';
import { canChangeExecutor, taskFormSchema, zodValidate, type Task, type TaskForm } from '../lib/domain';
import { errorMessage } from '../lib/errors';

export function TaskFormModal({
  task,
  objectId,
  onClose,
}: {
  task?: Task;
  objectId?: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const objects = useQuery({ queryKey: ['objects'], queryFn: listObjects });
  const executors = useQuery({ queryKey: ['executors'], queryFn: listExecutors });

  const form = useForm<TaskForm>({
    initialValues: {
      title: task?.title ?? '',
      description: task?.description ?? '',
      object_id: task?.object_id ?? objectId ?? '',
      executor_id: task?.executor_id ?? '',
    },
    validate: zodValidate(taskFormSchema),
  });

  const save = useMutation({
    mutationFn: (values: TaskForm) => (task ? updateTask(task.id, values) : createTask(values)),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const executorLocked = task !== undefined && !canChangeExecutor(task);

  return (
    <Modal opened onClose={onClose} title={task ? 'Редактирование задачи' : 'Новая задача'}>
      <form onSubmit={form.onSubmit((values) => save.mutate(taskFormSchema.parse(values)))}>
        <Stack>
          <TextInput label="Название" withAsterisk {...form.getInputProps('title')} />
          <Textarea label="Описание" autosize minRows={3} {...form.getInputProps('description')} />
          <Select
            label="Объект"
            withAsterisk
            searchable
            data={(objects.data ?? []).map((o) => ({ value: o.id, label: o.name }))}
            {...form.getInputProps('object_id')}
          />
          <Select
            label="Исполнитель"
            withAsterisk
            searchable
            disabled={executorLocked}
            description={
              executorLocked ? 'Пока задача на проверке, сменить исполнителя нельзя' : undefined
            }
            data={(executors.data ?? []).map((p) => ({ value: p.id, label: p.full_name }))}
            {...form.getInputProps('executor_id')}
          />
          {(error || objects.error || executors.error) && (
            <Alert color="red">{error ?? errorMessage(objects.error ?? executors.error)}</Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" loading={save.isPending}>
              Сохранить
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
