import { describe, expect, it } from 'vitest';
import {
  alertKindLabel,
  endReasonLabel,
  endSourceNote,
  outcomeLabel,
  reasonLabel,
  sessionStatusLabel,
} from './labels';

describe('labels lib', () => {
  describe('outcomeLabel', () => {
    it('translates known outcomes', () => {
      expect(outcomeLabel('granted')).toBe('Cho vào');
      expect(outcomeLabel('denied')).toBe('Từ chối');
      expect(outcomeLabel('noop')).toBe('Đã trong phiên');
      expect(outcomeLabel('error')).toBe('Lỗi');
    });

    it('returns raw string for unknown outcome', () => {
      expect(outcomeLabel('unexpected_outcome')).toBe('unexpected_outcome');
    });
  });

  describe('reasonLabel', () => {
    it('translates simple reasons', () => {
      expect(reasonLabel('unknown_card')).toBe('Thẻ chưa đăng ký');
      expect(reasonLabel('card_disabled')).toBe('Thẻ bị khóa');
      expect(reasonLabel('user_inactive')).toBe('Người dùng bị vô hiệu hóa');
      expect(reasonLabel('no_schedule')).toBe('Không có lịch ở máy này');
      expect(reasonLabel('out_of_schedule')).toBe('Ngoài giờ được phép');
      expect(reasonLabel('workstation_busy')).toBe('Máy đang có người dùng');
      expect(reasonLabel('ambiguous_profile')).toBe('Lịch mâu thuẫn profile');
      expect(reasonLabel('profile_disabled')).toBe('Profile bị tắt');
      expect(reasonLabel('profile_not_found')).toBe('Máy không có profile');
      expect(reasonLabel('invalid_uid')).toBe('UID đọc được không hợp lệ');
      expect(reasonLabel('reader_error')).toBe('Lỗi đầu đọc');
      expect(reasonLabel('internal_error')).toBe('Lỗi nội bộ của máy');
    });

    it('handles data_stale and details', () => {
      expect(reasonLabel('data_stale')).toBe('Dữ liệu trên máy hết hạn');
      expect(reasonLabel('data_stale', 'no_data')).toBe('Dữ liệu trên máy hết hạn (chưa có dữ liệu)');
      expect(reasonLabel('data_stale', 'lease_expired')).toBe('Dữ liệu trên máy hết hạn (quá hạn tin cậy)');
      expect(reasonLabel('data_stale', 'clock_invalid')).toBe('Dữ liệu trên máy hết hạn (đồng hồ máy sai)');
      expect(reasonLabel('data_stale', 'unknown_detail')).toBe('Dữ liệu trên máy hết hạn (unknown_detail)');
    });

    it('handles already_active and detail extended', () => {
      expect(reasonLabel('already_active')).toBe('Đang trong phiên của mình');
      expect(reasonLabel('already_active', 'extended')).toBe('Đang trong phiên của mình, đã gia hạn phiên');
      expect(reasonLabel('already_active', 'other')).toBe('Đang trong phiên của mình');
    });

    it('handles granted and details', () => {
      expect(reasonLabel('granted')).toBe('Hợp lệ');
      expect(reasonLabel('granted', 'superseded')).toBe('Hợp lệ, thay phiên cũ');
      expect(reasonLabel('granted', 'os_session_lost')).toBe('Hợp lệ, phiên cũ đã mất');
      expect(reasonLabel('granted', 'normal')).toBe('Hợp lệ');
    });

    it('returns raw code for unknown reason', () => {
      expect(reasonLabel('custom_reason')).toBe('custom_reason');
    });
  });

  describe('sessionStatusLabel', () => {
    it('translates known session statuses', () => {
      expect(sessionStatusLabel('active')).toBe('Đang dùng');
      expect(sessionStatusLabel('completed')).toBe('Đã kết thúc');
      expect(sessionStatusLabel('forced_logout')).toBe('Bị đăng xuất');
      expect(sessionStatusLabel('abandoned')).toBe('Bị bỏ dở');
    });

    it('returns raw string for unknown status', () => {
      expect(sessionStatusLabel('pending')).toBe('pending');
    });
  });

  describe('endReasonLabel', () => {
    it('translates known end reasons', () => {
      expect(endReasonLabel('user_logout')).toBe('Tự đăng xuất');
      expect(endReasonLabel('schedule_expired')).toBe('Hết giờ');
      expect(endReasonLabel('workstation_rebooted')).toBe('Máy khởi động lại');
      expect(endReasonLabel('superseded')).toBe('Bị người sau thay');
      expect(endReasonLabel('os_session_lost')).toBe('Mất phiên hệ điều hành');
    });

    it('handles empty or unknown end reasons', () => {
      expect(endReasonLabel(null)).toBe('');
      expect(endReasonLabel(undefined)).toBe('');
      expect(endReasonLabel('custom_end')).toBe('custom_end');
    });
  });

  describe('endSourceNote', () => {
    it('translates known end sources', () => {
      expect(endSourceNote('reconstructed')).toBe('(dựng lại khi máy khởi động)');
      expect(endSourceNote('inferred')).toBe('(server suy luận)');
      expect(endSourceNote('reported')).toBe('');
      expect(endSourceNote(null)).toBe('');
      expect(endSourceNote(undefined)).toBe('');
    });
  });

  describe('alertKindLabel', () => {
    it('translates known alert kinds', () => {
      expect(alertKindLabel('snapshot_signature_invalid')).toBe(
        'Snapshot có chữ ký sai (bị từ chối)',
      );
      expect(alertKindLabel('edge_db_recovered')).toBe(
        'CSDL trên máy hỏng và đã dựng lại',
      );
      expect(alertKindLabel('key_version_mismatch')).toBe(
        'Máy dùng khóa cũ (cần cài lại?)',
      );
      expect(alertKindLabel('teardown_failed_stuck_resource')).toBe(
        'Không dọn được phiên cũ',
      );
    });

    it('returns raw string for unknown kind', () => {
      expect(alertKindLabel('unknown_alert_kind')).toBe('unknown_alert_kind');
    });
  });
});

