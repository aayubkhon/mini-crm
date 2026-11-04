import { useState, type ReactNode } from 'react';
import { Alert, Badge, Button, Center, Group, Loader, Modal, Stack, Text } from '@mantine/core';
import { STATUS_COLORS, STATUS_LABELS, type TaskStatus } from '../lib/domain';
import { errorMessage } from '../lib/errors';

export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <Badge color={STATUS_COLORS[status]} variant="light">
      {STATUS_LABELS[status]}
    </Badge>
  );
}

// Единое отображение загрузки, ошибки и случая «записи нет или нет доступа».
export function QueryState({
  isPending,
  error,
  isEmpty,
  emptyText,
  children,
}: {
  isPending: boolean;
  error: unknown;
  isEmpty?: boolean;
  emptyText?: string;
  children: () => ReactNode;
}) {
  if (isPending) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }
  if (error) return <Alert color="red">{errorMessage(error)}</Alert>;
  if (isEmpty) return <Text c="dimmed">{emptyText}</Text>;
  return <>{children()}</>;
}

export function ConfirmDeleteModal({
  title,
  text,
  onConfirm,
  onClose,
  describeError = errorMessage,
}: {
  title: string;
  text: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
  describeError?: (error: unknown) => string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  };

  return (
    <Modal opened onClose={onClose} title={title}>
      <Stack>
        <Text>{text}</Text>
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Отмена
          </Button>
          <Button color="red" loading={busy} onClick={() => void confirm()}>
            Удалить
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
