import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Anchor, Button, Group, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { useProfile } from '../auth/AuthProvider';
import { ConfirmDeleteModal, QueryState, StatusBadge } from '../components/common';
import { TaskActions } from '../components/TaskActions';
import { TaskFormModal } from '../components/TaskFormModal';
import { deleteTask, getHistory, getTask } from '../lib/api';
import { canEditTask, formatDateTime, STATUS_LABELS } from '../lib/domain';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <div>{children}</div>
    </div>
  );
}

export function TaskPage() {
  const { id = '' } = useParams();
  const profile = useProfile();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<'edit' | 'delete' | null>(null);

  const taskQuery = useQuery({ queryKey: ['task', id], queryFn: () => getTask(id) });
  const history = useQuery({
    queryKey: ['history', id],
    queryFn: () => getHistory(id),
    enabled: !!taskQuery.data,
  });
  const task = taskQuery.data;

  return (
    <QueryState
      isPending={taskQuery.isPending}
      error={taskQuery.error}
      isEmpty={!task}
      emptyText="Задача не найдена или у вас нет к ней доступа."
    >
      {() => (
        <Stack gap="lg">
          <Group justify="space-between" align="flex-start">
            <Title order={2}>{task!.title}</Title>
            {profile.role === 'manager' && (
              <Group>
                {canEditTask(task!) && (
                  <Button variant="default" onClick={() => setDialog('edit')}>
                    Редактировать
                  </Button>
                )}
                <Button variant="default" color="red" onClick={() => setDialog('delete')}>
                  Удалить
                </Button>
              </Group>
            )}
          </Group>

          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Field label="Статус">
              <StatusBadge status={task!.status} />
            </Field>
            <Field label="Объект">
              <Anchor component={Link} to={`/objects/${task!.object_id}`}>
                {task!.object?.name ?? '—'}
              </Anchor>
            </Field>
            <Field label="Исполнитель">{task!.executor?.full_name ?? '—'}</Field>
            <Field label="Автор">{task!.author?.full_name ?? '—'}</Field>
            <Field label="Дата создания">{formatDateTime(task!.created_at)}</Field>
          </SimpleGrid>
          <Field label="Описание">
            <Text style={{ whiteSpace: 'pre-wrap' }}>{task!.description || '—'}</Text>
          </Field>

          <TaskActions task={task!} />

          <Stack gap="xs">
            <Title order={3}>История</Title>
            <QueryState isPending={history.isPending} error={history.error}>
              {() => (
                <Table striped>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Когда</Table.Th>
                      <Table.Th>Кто</Table.Th>
                      <Table.Th>Из статуса</Table.Th>
                      <Table.Th>В статус</Table.Th>
                      <Table.Th>Комментарий</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {history.data?.map((entry) => (
                      <Table.Tr key={entry.id}>
                        <Table.Td>{formatDateTime(entry.created_at)}</Table.Td>
                        <Table.Td>{entry.actor?.full_name ?? '—'}</Table.Td>
                        <Table.Td>{entry.from_status ? STATUS_LABELS[entry.from_status] : '—'}</Table.Td>
                        <Table.Td>{STATUS_LABELS[entry.to_status]}</Table.Td>
                        <Table.Td style={{ whiteSpace: 'pre-wrap' }}>{entry.comment ?? '—'}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </QueryState>
          </Stack>

          {dialog === 'edit' && <TaskFormModal task={task!} onClose={() => setDialog(null)} />}
          {dialog === 'delete' && (
            <ConfirmDeleteModal
              title="Удаление задачи"
              text={`Удалить задачу «${task!.title}»? Она исчезнет из всех списков.`}
              onClose={() => setDialog(null)}
              onConfirm={async () => {
                await deleteTask(id);
                await queryClient.invalidateQueries({ queryKey: ['tasks'] });
                void navigate(`/objects/${task!.object_id}`, { replace: true });
              }}
            />
          )}
        </Stack>
      )}
    </QueryState>
  );
}
