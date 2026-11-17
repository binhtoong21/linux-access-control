import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './auth/AuthProvider';
import { RequireAuth } from './auth/RequireAuth';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { WorkstationsPage } from './pages/WorkstationsPage';
import { UsersPage } from './pages/UsersPage';
import { UserDetailPage } from './pages/UserDetailPage';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: true,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              element={
                <RequireAuth>
                  <Layout />
                </RequireAuth>
              }
            >
              <Route path="/workstations" element={<WorkstationsPage />} />
              <Route path="/users" element={<UsersPage />} />
              <Route path="/users/:id" element={<UserDetailPage />} />
              <Route path="/" element={<Navigate to="/workstations" replace />} />
              <Route path="*" element={<Navigate to="/workstations" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
