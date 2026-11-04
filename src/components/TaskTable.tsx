import { Link } from 'react-router';
import { Anchor, Table } from '@mantine/core';
import { formatDateTime, type Task } from '../lib/domain';
import { StatusBadge } from './common';

export function TaskTable({ tasks, show }: { tasks: Task[]; show: 'object' | 'executor' }) {
  return (
    <Table striped>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Название</Table.Th>
          <Table.Th>{show === 'object' ? 'Объект' : 'Исполнитель'}</Table.Th>
          <Table.Th>Статус</Table.Th>
          <Table.Th>Создана</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {tasks.map((task) => (
          <Table.Tr key={task.id}>
            <Table.Td>
              <Anchor component={Link} to={`/tasks/${task.id}`}>
                {task.title}
              </Anchor>
            </Table.Td>
            <Table.Td>
              {show === 'object' ? (
                <Anchor component={Link} to={`/objects/${task.object_id}`}>
                  {task.object?.name ?? '—'}
                </Anchor>
              ) : (
                (task.executor?.full_name ?? '—')
              )}
            </Table.Td>
            <Table.Td>
              <StatusBadge status={task.status} />
            </Table.Td>
            <Table.Td>{formatDateTime(task.created_at)}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
