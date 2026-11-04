import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Group, Stack, Text, Title } from '@mantine/core';
import { useProfile } from '../auth/AuthProvider';
import { ConfirmDeleteModal, QueryState } from '../components/common';
import { ObjectFormModal } from '../components/ObjectFormModal';
import { TaskFormModal } from '../components/TaskFormModal';
import { TaskTable } from '../components/TaskTable';
import { deleteObject, getObject, listTasks } from '../lib/api';
import { deleteObjectErrorMessage } from '../lib/errors';

export function ObjectPage() {
  const { id = '' } = useParams();
  const profile = useProfile();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<'edit' | 'delete' | 'task' | null>(null);

  const object = useQuery({ queryKey: ['object', id], queryFn: () => getObject(id) });
  const tasks = useQuery({
    queryKey: ['tasks', { objectId: id }],
    queryFn: () => listTasks({ objectId: id }),
    enabled: !!object.data,
  });
  const isManager = profile.role === 'manager';

  return (
    <QueryState
      isPending={object.isPending}
      error={object.error}
      isEmpty={!object.data}
      emptyText="Объект не найден или у вас нет к нему доступа."
    >
      {() => (
        <Stack>
          <Group justify="space-between" align="flex-start">
            <div>
              <Title order={2}>{object.data!.name}</Title>
              <Text c="dimmed">{object.data!.address}</Text>
            </div>
            {isManager && (
              <Group>
                <Button variant="default" onClick={() => setDialog('edit')}>
                  Редактировать
                </Button>
                <Button variant="default" color="red" onClick={() => setDialog('delete')}>
                  Удалить
                </Button>
              </Group>
            )}
          </Group>

          <Group justify="space-between">
            <Title order={3}>{isManager ? 'Задачи' : 'Мои задачи на объекте'}</Title>
            {isManager && <Button onClick={() => setDialog('task')}>Новая задача</Button>}
          </Group>
          <QueryState
            isPending={tasks.isPending}
            error={tasks.error}
            isEmpty={tasks.data?.length === 0}
            emptyText="Задач пока нет."
          >
            {() => <TaskTable tasks={tasks.data!} show="executor" />}
          </QueryState>

          {dialog === 'edit' && <ObjectFormModal object={object.data!} onClose={() => setDialog(null)} />}
          {dialog === 'task' && <TaskFormModal objectId={id} onClose={() => setDialog(null)} />}
          {dialog === 'delete' && (
            <ConfirmDeleteModal
              title="Удаление объекта"
              text={`Удалить объект «${object.data!.name}»?`}
              describeError={deleteObjectErrorMessage}
              onClose={() => setDialog(null)}
              onConfirm={async () => {
                await deleteObject(id);
                await queryClient.invalidateQueries({ queryKey: ['objects'] });
                void navigate('/objects', { replace: true });
              }}
            />
          )}
        </Stack>
      )}
    </QueryState>
  );
}
