import { createRoot } from 'react-dom/client';
import { Alert, Container, createTheme, MantineProvider, Modal } from '@mantine/core';
import '@mantine/core/styles.css';
import { envError } from './lib/env';

const root = createRoot(document.getElementById('root')!);

// Случайный клик мимо окна или Esc не должны стирать введённые данные.
// Окно закрывается только кнопками «Отмена» и «×» или после сохранения.
const theme = createTheme({
  components: {
    Modal: Modal.extend({ defaultProps: { closeOnClickOutside: false, closeOnEscape: false } }),
  },
});

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
      <MantineProvider theme={theme}>
        <App />
      </MantineProvider>,
    );
  });
}
