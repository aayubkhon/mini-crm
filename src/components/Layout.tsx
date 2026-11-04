import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { Anchor, Button, Container, Divider, Group, Text } from '@mantine/core';
import { useProfile } from '../auth/AuthProvider';
import { supabase } from '../lib/api';
import { ROLE_LABELS } from '../lib/domain';

export function Layout({ children }: { children: ReactNode }) {
  const profile = useProfile();
  return (
    <>
      <Container size="lg" py="sm">
        <Group justify="space-between">
          <Group>
            <Anchor component={NavLink} to="/objects">
              Объекты
            </Anchor>
            {profile.role === 'executor' && (
              <Anchor component={NavLink} to="/my-tasks">
                Мои задачи
              </Anchor>
            )}
          </Group>
          <Group gap="sm">
            <Text size="sm" c="dimmed">
              {profile.full_name}, {ROLE_LABELS[profile.role]}
            </Text>
            <Button size="xs" variant="default" onClick={() => void supabase.auth.signOut()}>
              Выйти
            </Button>
          </Group>
        </Group>
      </Container>
      <Divider />
      <Container size="lg" py="md">
        {children}
      </Container>
    </>
  );
}
