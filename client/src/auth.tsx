import { createContext, useContext, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AuthError, api, type User } from './api';

interface Auth {
  user: User | null;
  loading: boolean;
  login: ReturnType<typeof useLoginMutation>;
  register: ReturnType<typeof useRegisterMutation>;
  logout: () => void;
}

const AuthContext = createContext<Auth | null>(null);

function useLoginMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) => api.login(email, password),
    onSuccess: (user) => qc.setQueryData(['me'], user),
  });
}

function useRegisterMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, email, password }: { name: string; email: string; password: string }) => api.register(name, email, password),
    onSuccess: (user) => qc.setQueryData(['me'], user),
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.me();
      } catch (err) {
        if (err instanceof AuthError) return null;
        throw err;
      }
    },
    staleTime: Infinity,
    retry: false,
  });
  const login = useLoginMutation();
  const register = useRegisterMutation();

  const logout = async () => {
    await api.logout().catch(() => {});
    qc.clear();
    qc.setQueryData(['me'], null);
  };

  return (
    <AuthContext.Provider value={{ user: me.data ?? null, loading: me.isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): Auth {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fuera de AuthProvider');
  return ctx;
}
