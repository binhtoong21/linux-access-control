import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { AuditTab } from './history/AuditTab';
import { SessionsTab } from './history/SessionsTab';
import { AdminActionsTab } from './history/AdminActionsTab';
import {
  Button,
  PageHeader,
} from '../components/ui';

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
      <PageHeader
        title="Lịch sử"
        description="Nhật ký quẹt thẻ, phiên sử dụng máy và các thao tác quản trị"
      />

      {/* Tab Navigation */}
      <div className="border-b border-line">
        <nav className="flex flex-wrap gap-2 pb-4" aria-label="Tabs">
          <Button
            type="button"
            onClick={() => handleTabChange('audit')}
            variant={activeTab === 'audit' ? 'primary' : 'secondary'}
            aria-current={activeTab === 'audit' ? 'page' : undefined}
          >
            Quẹt thẻ
          </Button>
          <Button
            type="button"
            onClick={() => handleTabChange('sessions')}
            variant={activeTab === 'sessions' ? 'primary' : 'secondary'}
            aria-current={activeTab === 'sessions' ? 'page' : undefined}
          >
            Phiên
          </Button>
          <Button
            type="button"
            onClick={() => handleTabChange('admin')}
            variant={activeTab === 'admin' ? 'primary' : 'secondary'}
            aria-current={activeTab === 'admin' ? 'page' : undefined}
          >
            Thao tác quản trị
          </Button>
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
