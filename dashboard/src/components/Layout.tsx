import React, { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Button } from './ui';

interface NavGroup {
  heading: string;
  items: { label: string; to: string }[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    heading: 'Vận hành',
    items: [
      { label: 'Máy trạm', to: '/workstations' },
      { label: 'Sự cố', to: '/issues' },
      { label: 'Lịch sử', to: '/history' },
    ],
  },
  {
    heading: 'Danh tính',
    items: [
      { label: 'Người dùng', to: '/users' },
      { label: 'Nhóm', to: '/groups' },
      { label: 'Thẻ', to: '/cards' },
      { label: 'Nhập CSV', to: '/import' },
    ],
  },
  {
    heading: 'Cấu hình',
    items: [
      { label: 'Lịch', to: '/schedules' },
      { label: 'Zone', to: '/zones' },
      { label: 'Duyệt máy', to: '/enrollment' },
    ],
  },
];

export function Layout() {
  const { admin, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const wasOpenRef = useRef(false);

  // Below 900 px the sidebar is an overlay: while it is open, focus stays inside it and the page behind is inert;
  // closing it returns focus to the Menu button.
  useEffect(() => {
    const behind = [headerRef.current, mainRef.current];
    if (!mobileOpen) {
      behind.forEach((el) => el?.removeAttribute('inert'));
      if (wasOpenRef.current) headerRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
      wasOpenRef.current = false;
      return;
    }
    wasOpenRef.current = true;
    behind.forEach((el) => el?.setAttribute('inert', ''));
    const focusables = () =>
      Array.from(asideRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? []);
    focusables()[0]?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileOpen(false);
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      behind.forEach((el) => el?.removeAttribute('inert'));
    };
  }, [mobileOpen]);

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
    <div className="min-h-screen bg-canvas flex flex-col min-[900px]:flex-row">
      {/* 48 px top bar below 900 px */}
      <header ref={headerRef} className="h-12 bg-surface border-b border-line flex items-center px-4 min-[900px]:hidden shrink-0">
        <Button
          variant="quiet"
          size="sm"
          onClick={() => setMobileOpen((open) => !open)}
          aria-label="Menu"
          aria-expanded={mobileOpen}
        >
          Menu
        </Button>
        <span className="text-sm font-semibold text-ink ml-3">NFC Lab</span>
      </header>

      {/* Mobile overlay backdrop */}
      {mobileOpen && (
        <div
          data-testid="sidebar-backdrop"
          className="fixed inset-0 bg-[rgba(27,34,32,0.4)] z-40 min-[900px]:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar (220 px) */}
      <aside
        ref={asideRef}
        className={`bg-surface border-r border-line flex flex-col ${
          mobileOpen
            ? 'fixed inset-y-0 left-0 z-50 w-[220px] shadow-md min-[900px]:static min-[900px]:z-auto min-[900px]:shadow-none'
            : 'hidden min-[900px]:flex min-[900px]:static min-[900px]:w-[220px] min-[900px]:shrink-0'
        }`}
      >
        {/* Brand */}
        <div className="p-4 border-b border-line">
          <div className="text-base font-semibold text-ink">NFC Lab</div>
          <div className="text-xs text-ink-muted">Quản trị</div>
        </div>

        {/* Nav groups */}
        <nav className="flex-1 overflow-y-auto py-3">
          {NAV_GROUPS.map((group, index) => (
            // Groups are separated by a hairline; the heading is a quiet caption and the items sit indented under it.
            <div key={group.heading} role="group" aria-label={group.heading} className={index > 0 ? 'mt-3 pt-3 border-t border-line' : ''}>
              <div className="px-3 pb-1 text-xs font-normal text-ink-muted">
                {group.heading}
              </div>
              <div>
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center h-8 pl-5 pr-3 text-sm transition-colors border-l-2 ${
                        isActive
                          ? 'bg-accent-tint text-accent font-medium border-accent'
                          : 'border-transparent text-ink hover:bg-canvas'
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom */}
        <div className="mt-auto p-4 border-t border-line space-y-2">
          <div className="text-xs text-ink-muted truncate" title={admin?.display_name}>
            {admin?.display_name}
          </div>
          {logoutError && (
            <div className="text-xs text-danger" role="alert">
              {logoutError}
            </div>
          )}
          <Button
            variant="quiet"
            size="sm"
            onClick={handleLogout}
            loading={loggingOut}
            disabled={loggingOut}
          >
            Đăng xuất
          </Button>
        </div>
      </aside>

      {/* Main content area */}
      <main ref={mainRef} className="flex-1 p-6 max-w-[1200px] w-full mx-auto overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
