import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { AuditTab } from './history/AuditTab';
import { SessionsTab } from './history/SessionsTab';
import { AdminActionsTab } from './history/AdminActionsTab';

export type TabKey = 'audit' | 'sessions' | 'admin';

export function HistoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const tabParam = searchParams.get('tab');
  const activeTab: TabKey =
    tabParam === 'sessions' ? 'sessions' : tabParam === 'admin' ? 'admin' : 'audit';

  const workstationId = searchParams.get('workstation_id') || undefined;
  const userId = searchParams.get('user_id') || undefined;

  const handleTabChange = (newTab: TabKey) => {
    const nextParams = new URLSearchParams(searchParams);
    if (newTab === 'audit') {
      nextParams.delete('tab');
    } else {
      nextParams.set('tab', newTab);
    }
    setSearchParams(nextParams);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Lịch sử</h1>
        <p className="text-sm text-gray-500">
          Nhật ký quẹt thẻ, phiên sử dụng máy và các thao tác quản trị
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8" aria-label="Tabs">
          <button
            type="button"
            onClick={() => handleTabChange('audit')}
            className={`whitespace-nowrap pb-3 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'audit'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Quẹt thẻ
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('sessions')}
            className={`whitespace-nowrap pb-3 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'sessions'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Phiên
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('admin')}
            className={`whitespace-nowrap pb-3 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'admin'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Thao tác quản trị
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'audit' && (
          <AuditTab
            key={`audit-${workstationId || ''}-${userId || ''}`}
            initialWorkstationId={workstationId}
            initialUserId={userId}
          />
        )}
        {activeTab === 'sessions' && (
          <SessionsTab
            key={`sessions-${workstationId || ''}-${userId || ''}`}
            initialWorkstationId={workstationId}
            initialUserId={userId}
          />
        )}
        {activeTab === 'admin' && <AdminActionsTab />}
      </div>
    </div>
  );
}
