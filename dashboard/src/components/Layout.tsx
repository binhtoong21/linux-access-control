import React, { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

export function Layout() {
  const { admin, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  const handleLogout = async () => {
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await logout();
    } catch {
      setLogoutError('Đăng xuất không thành công, thử lại');
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-6">
          <span className="font-bold text-lg text-gray-900">NFC Lab — Quản trị</span>
          <nav className="flex space-x-4">
            <NavLink
              to="/workstations"
              className={({ isActive }) =>
                isActive
                  ? 'text-blue-600 font-medium px-2 py-1 rounded bg-blue-50'
                  : 'text-gray-600 hover:text-gray-900 px-2 py-1'
              }
            >
              Máy trạm
            </NavLink>
            <NavLink
              to="/users"
              className={({ isActive }) =>
                isActive
                  ? 'text-blue-600 font-medium px-2 py-1 rounded bg-blue-50'
                  : 'text-gray-600 hover:text-gray-900 px-2 py-1'
              }
            >
              Người dùng
            </NavLink>
            <NavLink
              to="/groups"
              className={({ isActive }) =>
                isActive
                  ? 'text-blue-600 font-medium px-2 py-1 rounded bg-blue-50'
                  : 'text-gray-600 hover:text-gray-900 px-2 py-1'
              }
            >
              Nhóm
            </NavLink>
            <NavLink
              to="/cards"
              className={({ isActive }) =>
                isActive
                  ? 'text-blue-600 font-medium px-2 py-1 rounded bg-blue-50'
                  : 'text-gray-600 hover:text-gray-900 px-2 py-1'
              }
            >
              Thẻ
            </NavLink>
            <NavLink
              to="/import"
              className={({ isActive }) =>
                isActive
                  ? 'text-blue-600 font-medium px-2 py-1 rounded bg-blue-50'
                  : 'text-gray-600 hover:text-gray-900 px-2 py-1'
              }
            >
              Nhập CSV
            </NavLink>
          </nav>
        </div>
        <div className="flex items-center space-x-4">
          <span className="text-sm text-gray-700">{admin?.display_name}</span>
          {logoutError && (
            <span className="text-sm text-red-600">{logoutError}</span>
          )}
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="text-sm px-3 py-1.5 border border-gray-300 rounded text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            Đăng xuất
          </button>
        </div>
      </header>
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto">
        <Outlet />
      </main>
    </div>
  );
}

