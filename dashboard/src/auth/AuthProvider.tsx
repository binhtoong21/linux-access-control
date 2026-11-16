import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { me, login as apiLogin, logout as apiLogout } from '../api/endpoints';
import { ApiError, onUnauthorized } from '../api/client';
import type { Admin } from '../api/types';

interface AuthContextValue {
  admin: Admin | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();
  const generationRef = useRef(0);

  useEffect(() => {
    let mounted = true;
    const gen = ++generationRef.current;
    me()
      .then((data) => {
        if (mounted && generationRef.current === gen) {
          setAdmin(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (mounted && generationRef.current === gen) {
          if (err instanceof ApiError && err.status === 401) {
            setAdmin(null);
          } else {
            setAdmin(null);
          }
          setLoading(false);
        }
      });

    const unsubscribe = onUnauthorized(() => {
      ++generationRef.current;
      setAdmin(null);
      queryClient.clear();
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [queryClient]);

  const handleLogin = async (u: string, p: string) => {
    const gen = ++generationRef.current;
    try {
      await apiLogin(u, p);
      const adminData = await me();
      if (generationRef.current === gen) {
        setAdmin(adminData);
        setLoading(false);
      }
    } catch (err) {
      if (generationRef.current === gen) {
        setLoading(false);
      }
      throw err;
    }
  };

  const handleLogout = async () => {
    const gen = ++generationRef.current;
    try {
      await apiLogout();
      if (generationRef.current === gen) {
        setAdmin(null);
        queryClient.clear();
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        if (generationRef.current === gen) {
          setAdmin(null);
          queryClient.clear();
        }
        return;
      }
      throw err;
    }
  };

  return (
    <AuthContext.Provider value={{ admin, loading, login: handleLogin, logout: handleLogout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

