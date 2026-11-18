import React, { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { ApiError } from '../api/client';
import {
  Button,
  Field,
  fieldDescribedBy,
  inputClass,
  Notice,
  PageHeader,
} from '../components/ui';

export function LoginPage() {
  const { admin, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (admin) {
    return <Navigate to="/workstations" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);

    try {
      await login(username, password);
      const state = location.state as { from?: { pathname?: string } } | null;
      const from = state?.from?.pathname || '/workstations';
      navigate(from, { replace: true });
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.code === 'INVALID_CREDENTIALS') {
          setErrorMsg('Sai tên đăng nhập hoặc mật khẩu');
        } else if (
          err.code === 'ACCOUNT_LOCKED' ||
          err.code === 'TOO_MANY_ATTEMPTS' ||
          err.code === 'RATE_LIMITED' ||
          err.status === 429
        ) {
          setErrorMsg('Tạm khóa do đăng nhập sai nhiều lần, thử lại sau');
        } else if (err.code === 'NETWORK_ERROR') {
          setErrorMsg('Không kết nối được máy chủ');
        } else {
          setErrorMsg(err.message || 'Lỗi không xác định');
        }
      } else {
        setErrorMsg('Không kết nối được máy chủ');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
      <div className="max-w-[360px] w-full bg-surface border border-line rounded p-6 space-y-6">
        <PageHeader title="NFC Lab" description="Đăng nhập quản trị" />
        {errorMsg && (
          <Notice tone="danger">
            {errorMsg}
          </Notice>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Tên đăng nhập" htmlFor="username">
            <input
              id="username"
              aria-describedby={fieldDescribedBy('username', {})}
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              disabled={submitting}
              className={`w-full ${inputClass}`}
            />
          </Field>
          <Field label="Mật khẩu" htmlFor="password">
            <input
              id="password"
              aria-describedby={fieldDescribedBy('password', {})}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={submitting}
              className={`w-full ${inputClass}`}
            />
          </Field>
          <Button
            type="submit"
            variant="primary"
            loading={submitting}
            className="w-full"
          >
            Đăng nhập
          </Button>
        </form>
      </div>
    </div>
  );
}
