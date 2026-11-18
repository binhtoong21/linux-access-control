import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './auth/AuthProvider';
import { RequireAuth } from './auth/RequireAuth';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { WorkstationsPage } from './pages/WorkstationsPage';
import { WorkstationDetailPage } from './pages/WorkstationDetailPage';
import { UsersPage } from './pages/UsersPage';
import { UserDetailPage } from './pages/UserDetailPage';
import { GroupsPage } from './pages/GroupsPage';
import { GroupDetailPage } from './pages/GroupDetailPage';
import { CardsPage } from './pages/CardsPage';
import { ImportPage } from './pages/ImportPage';
import { ZonesPage } from './pages/ZonesPage';
import { EnrollmentPage } from './pages/EnrollmentPage';
import { SchedulesPage } from './pages/SchedulesPage';
import { ScheduleFormPage } from './pages/ScheduleFormPage';
import { HistoryPage } from './pages/HistoryPage';
import { IssuesPage } from './pages/IssuesPage';
import '@fontsource/be-vietnam-pro/400.css';
import '@fontsource/be-vietnam-pro/500.css';
import '@fontsource/be-vietnam-pro/600.css';
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
              <Route path="/workstations/:id" element={<WorkstationDetailPage />} />
              <Route path="/zones" element={<ZonesPage />} />
              <Route path="/enrollment" element={<EnrollmentPage />} />
              <Route path="/schedules" element={<SchedulesPage />} />
              <Route path="/schedules/new" element={<ScheduleFormPage />} />
              <Route path="/schedules/:id/edit" element={<ScheduleFormPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/issues" element={<IssuesPage />} />
              <Route path="/users" element={<UsersPage />} />
              <Route path="/users/:id" element={<UserDetailPage />} />
              <Route path="/groups" element={<GroupsPage />} />
              <Route path="/groups/:id" element={<GroupDetailPage />} />
              <Route path="/cards" element={<CardsPage />} />
              <Route path="/import" element={<ImportPage />} />
              <Route path="/" element={<Navigate to="/workstations" replace />} />
              <Route path="*" element={<Navigate to="/workstations" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
