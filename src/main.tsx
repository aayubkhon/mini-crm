import { createRoot } from 'react-dom/client';
import { Alert, Container, MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import { envError } from './lib/env';

const root = createRoot(document.getElementById('root')!);

if (envError) {
  root.render(
    <MantineProvider>
      <Container size="sm" py="xl">
        <Alert color="red" title="Приложение не настроено">
          {envError}
        </Alert>
      </Container>
    </MantineProvider>,
  );
} else {
  // Динамический импорт: клиент Supabase создаётся только с проверенными настройками.
  void import('./App').then(({ App }) => {
    root.render(
      <MantineProvider>
        <App />
      </MantineProvider>,
    );
  });
}
