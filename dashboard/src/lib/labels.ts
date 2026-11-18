export function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case 'granted':
      return 'Cho vào';
    case 'denied':
      return 'Từ chối';
    case 'noop':
      return 'Đã trong phiên';
    case 'error':
      return 'Lỗi';
    default:
      return outcome;
  }
}

export function reasonLabel(reason: string, detail?: unknown): string {
  switch (reason) {
    case 'unknown_card':
      return 'Thẻ chưa đăng ký';
    case 'card_disabled':
      return 'Thẻ bị khóa';
    case 'user_inactive':
      return 'Người dùng bị vô hiệu hóa';
    case 'no_schedule':
      return 'Không có lịch ở máy này';
    case 'out_of_schedule':
      return 'Ngoài giờ được phép';
    case 'data_stale': {
      if (detail === 'no_data') {
        return 'Dữ liệu trên máy hết hạn (chưa có dữ liệu)';
      }
      if (detail === 'lease_expired') {
        return 'Dữ liệu trên máy hết hạn (quá hạn tin cậy)';
      }
      if (detail === 'clock_invalid') {
        return 'Dữ liệu trên máy hết hạn (đồng hồ máy sai)';
      }
      if (typeof detail === 'string' && detail.trim().length > 0) {
        return `Dữ liệu trên máy hết hạn (${detail.trim()})`;
      }
      return 'Dữ liệu trên máy hết hạn';
    }
    case 'workstation_busy':
      return 'Máy đang có người dùng';
    case 'ambiguous_profile':
      return 'Lịch mâu thuẫn profile';
    case 'profile_disabled':
      return 'Profile bị tắt';
    case 'profile_not_found':
      return 'Máy không có profile';
    case 'already_active': {
      if (detail === 'extended') {
        return 'Đang trong phiên của mình, đã gia hạn phiên';
      }
      return 'Đang trong phiên của mình';
    }
    case 'granted': {
      if (detail === 'superseded') {
        return 'Hợp lệ, thay phiên cũ';
      }
      if (detail === 'os_session_lost') {
        return 'Hợp lệ, phiên cũ đã mất';
      }
      return 'Hợp lệ';
    }
    case 'invalid_uid':
      return 'UID đọc được không hợp lệ';
    case 'reader_error':
      return 'Lỗi đầu đọc';
    case 'internal_error':
      return 'Lỗi nội bộ của máy';
    default:
      return reason || '';
  }
}

export function sessionStatusLabel(status: string): string {
  switch (status) {
    case 'active':
      return 'Đang dùng';
    case 'completed':
      return 'Đã kết thúc';
    case 'forced_logout':
      return 'Bị đăng xuất';
    case 'abandoned':
      return 'Bị bỏ dở';
    default:
      return status;
  }
}

export function endReasonLabel(reason?: string | null): string {
  if (!reason) return '';
  switch (reason) {
    case 'user_logout':
      return 'Tự đăng xuất';
    case 'schedule_expired':
      return 'Hết giờ';
    case 'workstation_rebooted':
      return 'Máy khởi động lại';
    case 'superseded':
      return 'Bị người sau thay';
    case 'os_session_lost':
      return 'Mất phiên hệ điều hành';
    default:
      return reason;
  }
}

export function endSourceNote(source?: string | null): string {
  switch (source) {
    case 'reconstructed':
      return '(dựng lại khi máy khởi động)';
    case 'inferred':
      return '(server suy luận)';
    case 'reported':
    default:
      return '';
  }
}

export function alertKindLabel(kind: string): string {
  switch (kind) {
    case 'snapshot_signature_invalid':
      return 'Snapshot có chữ ký sai (bị từ chối)';
    case 'edge_db_recovered':
      return 'CSDL trên máy hỏng và đã dựng lại';
    case 'key_version_mismatch':
      return 'Máy dùng khóa cũ (cần cài lại?)';
    case 'teardown_failed_stuck_resource':
      return 'Không dọn được phiên cũ';
    default:
      return kind;
  }
}

