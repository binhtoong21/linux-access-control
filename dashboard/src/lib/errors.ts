import { ApiError } from '../api/client';

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'DUPLICATE':
        return 'Đã tồn tại (trùng mã hoặc tên).';
      case 'NOT_FOUND':
        return 'Không tìm thấy (có thể đã bị xóa).';
      case 'CARD_ALREADY_BOUND':
        return 'Thẻ này đang thuộc về người khác. Gỡ thẻ khỏi người đó trước.';
      case 'INVALID_UID':
        return 'UID không hợp lệ: cần 4, 7 hoặc 10 byte dạng hex.';
      case 'RANDOM_UID_NOT_SUPPORTED':
        return 'Thẻ dùng UID ngẫu nhiên (ví dụ CCCD, điện thoại), không dùng được để đăng nhập.';
      case 'INVALID_STATE_TRANSITION':
        return 'Không thể đổi trạng thái thẻ từ trạng thái hiện tại.';
      case 'REFERENCED_BY_SCHEDULE':
        return 'Đang được lịch sử dụng, không xóa được. Sửa hoặc xóa lịch trước.';
      case 'VALIDATION_ERROR':
        return 'Dữ liệu không hợp lệ: ' + (err.message || '');
      case 'NETWORK_ERROR':
        return 'Không kết nối được máy chủ';
      default:
        return err.message || 'Đã có lỗi, thử lại.';
    }
  }
  return 'Đã có lỗi, thử lại.';
}
