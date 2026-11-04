import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Anchor, Button, Group, Stack, Table, Title } from '@mantine/core';
import { useProfile } from '../auth/AuthProvider';
import { QueryState } from '../components/common';
import { ObjectFormModal } from '../components/ObjectFormModal';
import { listObjects } from '../lib/api';

export function ObjectsPage() {
  const profile = useProfile();
  const [creating, setCreating] = useState(false);
  const objects = useQuery({ queryKey: ['objects'], queryFn: listObjects });

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Объекты</Title>
        {profile.role === 'manager' && <Button onClick={() => setCreating(true)}>Новый объект</Button>}
      </Group>
      <QueryState
        isPending={objects.isPending}
        error={objects.error}
        isEmpty={objects.data?.length === 0}
        emptyText="Объектов пока нет."
      >
        {() => (
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Название</Table.Th>
                <Table.Th>Адрес</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {objects.data?.map((object) => (
                <Table.Tr key={object.id}>
                  <Table.Td>
                    <Anchor component={Link} to={`/objects/${object.id}`}>
                      {object.name}
                    </Anchor>
                  </Table.Td>
                  <Table.Td>{object.address}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </QueryState>
      {creating && <ObjectFormModal onClose={() => setCreating(false)} />}
    </Stack>
  );
}
