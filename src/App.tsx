import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router';
import { Alert, Button, Center, Container, Loader, Stack } from '@mantine/core';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { Layout } from './components/Layout';
import { supabase } from './lib/api';
import { errorMessage } from './lib/errors';
import { LoginPage } from './pages/LoginPage';
import { MyTasksPage } from './pages/MyTasksPage';
import { ObjectPage } from './pages/ObjectPage';
import { ObjectsPage } from './pages/ObjectsPage';
import { TaskPage } from './pages/TaskPage';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

function FullPageLoader() {
  return (
    <Center h="100vh">
      <Loader />
    </Center>
  );
}

function RequireProfile() {
  const { session, profile, loading, profileError } = useAuth();
  if (loading) return <FullPageLoader />;
  if (!session) return <Navigate to="/login" replace />;
  if (!profile) {
    return (
      <Container size="sm" py="xl">
        <Stack>
          <Alert color="red" title="Нет доступа">
            {profileError
              ? errorMessage(profileError)
              : 'Профиль пользователя не настроен. Обратитесь к администратору.'}
          </Alert>
          <Button variant="default" onClick={() => void supabase.auth.signOut()}>
            Выйти
          </Button>
        </Stack>
      </Container>
    );
  }
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}

// Перенаправления по роли только для удобства. Доступ к данным ограничивает база.
function HomeRedirect() {
  const { profile } = useAuth();
  return <Navigate to={profile?.role === 'executor' ? '/my-tasks' : '/objects'} replace />;
}

function ExecutorOnly() {
  const { profile } = useAuth();
  return profile?.role === 'executor' ? <Outlet /> : <Navigate to="/objects" replace />;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<RequireProfile />}>
              <Route path="/" element={<HomeRedirect />} />
              <Route path="/objects" element={<ObjectsPage />} />
              <Route path="/objects/:id" element={<ObjectPage />} />
              <Route path="/tasks/:id" element={<TaskPage />} />
              <Route element={<ExecutorOnly />}>
                <Route path="/my-tasks" element={<MyTasksPage />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
