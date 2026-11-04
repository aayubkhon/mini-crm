import { useState } from 'react';
import { useForm } from '@mantine/form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Group, Modal, Stack, TextInput } from '@mantine/core';
import { createObject, updateObject } from '../lib/api';
import { objectFormSchema, zodValidate, type ObjectForm, type SiteObject } from '../lib/domain';
import { errorMessage } from '../lib/errors';

export function ObjectFormModal({ object, onClose }: { object?: SiteObject; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<ObjectForm>({
    initialValues: { name: object?.name ?? '', address: object?.address ?? '' },
    validate: zodValidate(objectFormSchema),
  });

  const save = useMutation({
    mutationFn: (values: ObjectForm) =>
      object ? updateObject(object.id, values) : createObject(values),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Modal opened onClose={onClose} title={object ? 'Редактирование объекта' : 'Новый объект'}>
      <form onSubmit={form.onSubmit((values) => save.mutate(objectFormSchema.parse(values)))}>
        <Stack>
          <TextInput label="Название" withAsterisk {...form.getInputProps('name')} />
          <TextInput label="Адрес" withAsterisk {...form.getInputProps('address')} />
          {error && <Alert color="red">{error}</Alert>}
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
