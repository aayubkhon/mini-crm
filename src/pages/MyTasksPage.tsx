import { useQuery } from '@tanstack/react-query';
import { Stack, Title } from '@mantine/core';
import { useProfile } from '../auth/AuthProvider';
import { QueryState } from '../components/common';
import { TaskTable } from '../components/TaskTable';
import { listTasks } from '../lib/api';

export function MyTasksPage() {
  const profile = useProfile();
  const tasks = useQuery({
    queryKey: ['tasks', { executorId: profile.id }],
    queryFn: () => listTasks({ executorId: profile.id }),
  });

  return (
    <Stack>
      <Title order={2}>Мои задачи</Title>
      <QueryState
        isPending={tasks.isPending}
        error={tasks.error}
        isEmpty={tasks.data?.length === 0}
        emptyText="Назначенных задач пока нет."
      >
        {() => <TaskTable tasks={tasks.data!} show="object" />}
      </QueryState>
    </Stack>
  );
}
