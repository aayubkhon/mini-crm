import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getProfile, supabase } from '../lib/api';
import type { Profile } from '../lib/domain';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  profileError: unknown;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      // Данные одного пользователя не должны показываться следующему.
      if (event === 'SIGNED_OUT') queryClient.clear();
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);

  const userId = session?.user.id;
  const profileQuery = useQuery({
    queryKey: ['profile', userId],
    queryFn: () => getProfile(userId!),
    enabled: !!userId,
  });

  const state: AuthState = {
    session,
    // Роль берётся только из profiles, user_metadata не используется.
    profile: profileQuery.data ?? null,
    loading: !sessionReady || (!!userId && profileQuery.isPending),
    profileError: profileQuery.error,
  };

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth используется вне AuthProvider');
  return value;
}

// Для страниц внутри защищённого маршрута: там профиль уже точно загружен.
export function useProfile(): Profile {
  const { profile } = useAuth();
  if (!profile) throw new Error('useProfile используется вне защищённого маршрута');
  return profile;
}
