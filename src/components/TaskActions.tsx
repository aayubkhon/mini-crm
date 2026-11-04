import { useState } from 'react';
import { useForm } from '@mantine/form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Group, Modal, Stack, Text, Textarea } from '@mantine/core';
import { useProfile } from '../auth/AuthProvider';
import { changeTaskStatus } from '../lib/api';
import { availableTransitions, commentSchema, zodValidate, type Task, type Transition } from '../lib/domain';
import { errorMessage } from '../lib/errors';

function TransitionModal({
  task,
  transition,
  onClose,
}: {
  task: Task;
  transition: Transition;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const schema = commentSchema(transition.commentRequired);
  const form = useForm({ initialValues: { comment: '' }, validate: zodValidate(schema) });

  const change = useMutation({
    mutationFn: (comment: string) => changeTaskStatus(task.id, transition.to, comment),
    onSuccess: onClose,
    onError: (e) => setError(errorMessage(e)),
    // Обновляем и при ошибке: статус мог уже изменить другой пользователь.
    onSettled: () => queryClient.invalidateQueries(),
  });

  return (
    <Modal opened onClose={onClose} title={transition.label}>
      <form onSubmit={form.onSubmit((values) => change.mutate(schema.parse(values).comment))}>
        <Stack>
          <Textarea
            label="Комментарий"
            withAsterisk={transition.commentRequired}
            description={transition.commentRequired ? undefined : 'Необязательно'}
            autosize
            minRows={3}
            {...form.getInputProps('comment')}
          />
          {error && <Alert color="red">{error}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" loading={change.isPending}>
              {transition.label}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

export function TaskActions({ task }: { task: Task }) {
  const profile = useProfile();
  const [active, setActive] = useState<Transition | null>(null);
  const transitions = availableTransitions(task, profile);

  if (transitions.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        Сейчас для вас нет доступных действий по статусу.
      </Text>
    );
  }

  return (
    <>
      <Group>
        {transitions.map((t) => (
          <Button key={t.to} onClick={() => setActive(t)}>
            {t.label}
          </Button>
        ))}
      </Group>
      {active && <TransitionModal task={task} transition={active} onClose={() => setActive(null)} />}
    </>
  );
}
