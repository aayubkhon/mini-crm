import { useState } from 'react';
import { useForm } from '@mantine/form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Group, Modal, Select, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { createTask, listExecutors, listObjects, updateTask } from '../lib/api';
import { isContentLocked, taskFormSchema, zodValidate, type Task, type TaskForm } from '../lib/domain';
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

  const contentLocked = task !== undefined && isContentLocked(task);

  const save = useMutation({
    mutationFn: (values: TaskForm) => {
      if (!task) return createTask(values);
      return updateTask(task.id, contentLocked ? { executor_id: values.executor_id } : values);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Modal
      opened
      onClose={onClose}
      title={contentLocked ? 'Смена исполнителя' : task ? 'Редактирование задачи' : 'Новая задача'}
    >
      <form onSubmit={form.onSubmit((values) => save.mutate(taskFormSchema.parse(values)))}>
        <Stack>
          {contentLocked && (
            <Text size="sm" c="dimmed">
              В принятой задаче можно сменить только исполнителя. Статус не изменится.
            </Text>
          )}
          <TextInput
            label="Название"
            withAsterisk
            disabled={contentLocked}
            {...form.getInputProps('title')}
          />
          <Textarea
            label="Описание"
            autosize
            minRows={3}
            disabled={contentLocked}
            {...form.getInputProps('description')}
          />
          <Select
            label="Объект"
            withAsterisk
            searchable
            disabled={contentLocked}
            data={(objects.data ?? []).map((o) => ({ value: o.id, label: o.name }))}
            {...form.getInputProps('object_id')}
          />
          <Select
            label="Исполнитель"
            withAsterisk
            searchable
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
