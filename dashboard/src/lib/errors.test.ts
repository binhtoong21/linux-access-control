import { describe, it, expect } from 'vitest';
import { ApiError } from '../api/client';
import { errorMessage } from './errors';

describe('errorMessage', () => {
  it('maps DUPLICATE', () => {
    const err = new ApiError(409, 'DUPLICATE', 'duplicate');
    expect(errorMessage(err)).toBe('Đã tồn tại (trùng mã hoặc tên).');
  });

  it('maps CARD_ALREADY_BOUND', () => {
    const err = new ApiError(409, 'CARD_ALREADY_BOUND', 'bound');
    expect(errorMessage(err)).toBe('Thẻ này đang thuộc về người khác. Gỡ thẻ khỏi người đó trước.');
  });

  it('maps INVALID_UID', () => {
    const err = new ApiError(400, 'INVALID_UID', 'invalid uid');
    expect(errorMessage(err)).toBe('UID không hợp lệ: cần 4, 7 hoặc 10 byte dạng hex.');
  });

  it('maps RANDOM_UID_NOT_SUPPORTED', () => {
    const err = new ApiError(400, 'RANDOM_UID_NOT_SUPPORTED', 'random uid');
    expect(errorMessage(err)).toBe('Thẻ dùng UID ngẫu nhiên (ví dụ CCCD, điện thoại), không dùng được để đăng nhập.');
  });

  it('maps INVALID_STATE_TRANSITION', () => {
    const err = new ApiError(409, 'INVALID_STATE_TRANSITION', 'transition');
    expect(errorMessage(err)).toBe('Không thể đổi trạng thái thẻ từ trạng thái hiện tại.');
  });

  it('maps REFERENCED_BY_SCHEDULE', () => {
    const err = new ApiError(409, 'REFERENCED_BY_SCHEDULE', 'schedule');
    expect(errorMessage(err)).toBe('Đang được lịch sử dụng, không xóa được. Sửa hoặc xóa lịch trước.');
  });

  it('maps VALIDATION_ERROR with server message', () => {
    const err = new ApiError(400, 'VALIDATION_ERROR', 'Mã không đúng định dạng');
    expect(errorMessage(err)).toBe('Dữ liệu không hợp lệ: Mã không đúng định dạng');
  });

  it('maps NETWORK_ERROR', () => {
    const err = new ApiError(0, 'NETWORK_ERROR', 'Network error');
    expect(errorMessage(err)).toBe('Không kết nối được máy chủ');
  });

  it('falls back to server message for unknown ApiError code', () => {
    const err = new ApiError(500, 'INTERNAL_SERVER_ERROR', 'Lỗi nội bộ máy chủ');
    expect(errorMessage(err)).toBe('Lỗi nội bộ máy chủ');
  });

  it('falls back to generic message for unknown ApiError code with empty message', () => {
    const err = new ApiError(500, 'UNKNOWN', '');
    expect(errorMessage(err)).toBe('Đã có lỗi, thử lại.');
  });

  it('falls back to generic message for non-ApiError', () => {
    expect(errorMessage(new Error('Random JS error'))).toBe('Đã có lỗi, thử lại.');
    expect(errorMessage(null)).toBe('Đã có lỗi, thử lại.');
    expect(errorMessage('string error')).toBe('Đã có lỗi, thử lại.');
  });
});
