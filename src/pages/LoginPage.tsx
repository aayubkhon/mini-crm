import { useState } from 'react';
import { Navigate } from 'react-router';
import { useForm } from '@mantine/form';
import { Alert, Button, Container, PasswordInput, Stack, TextInput, Title } from '@mantine/core';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/api';
import { loginFormSchema, zodValidate } from '../lib/domain';

export function LoginPage() {
  const { session } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useForm({
    initialValues: { email: '', password: '' },
    validate: zodValidate(loginFormSchema),
  });

  if (session) return <Navigate to="/" replace />;

  const submit = async (values: { email: string; password: string }) => {
    setBusy(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword(loginFormSchema.parse(values));
    if (signInError) {
      setError(
        signInError.code === 'invalid_credentials'
          ? 'Неверный email или пароль.'
          : 'Не удалось войти. Попробуйте ещё раз.',
      );
      setBusy(false);
    }
  };

  return (
    <Container size={380} py={80}>
      <Title order={2} mb="md">
        Вход
      </Title>
      <form onSubmit={form.onSubmit((values) => void submit(values))}>
        <Stack>
          <TextInput label="Email" autoComplete="username" {...form.getInputProps('email')} />
          <PasswordInput label="Пароль" autoComplete="current-password" {...form.getInputProps('password')} />
          {error && <Alert color="red">{error}</Alert>}
          <Button type="submit" loading={busy}>
            Войти
          </Button>
        </Stack>
      </form>
    </Container>
  );
}
