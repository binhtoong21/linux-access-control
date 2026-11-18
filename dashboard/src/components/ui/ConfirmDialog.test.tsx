import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ConfirmDialog';
import { ApiError } from '../../api/client';

describe('ConfirmDialog', () => {
  it('Cancel calls onCancel and never onConfirm', () => {
    const handleConfirm = vi.fn();
    const handleCancel = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        title="Xác nhận"
        message="Bạn có chắc chắn?"
        confirmLabel="Đồng ý"
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(handleCancel).toHaveBeenCalledTimes(1);
    expect(handleConfirm).not.toHaveBeenCalled();
  });

  it('confirm calls onConfirm once even on double click', async () => {
    let resolvePromise: () => void = () => {};
    const handleConfirm = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvePromise = resolve;
        }),
    );
    const handleCancel = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        title="Xác nhận"
        message="Bạn có chắc chắn?"
        confirmLabel="Đồng ý"
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />,
    );

    const confirmBtn = screen.getByRole('button', { name: 'Đồng ý' });
    fireEvent.click(confirmBtn);
    fireEvent.click(confirmBtn);

    expect(handleConfirm).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolvePromise();
    });
  });

  it('with requireText the button is disabled until the text matches', async () => {
    const user = userEvent.setup();
    const handleConfirm = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        title="Xóa máy trạm"
        message="Hành động không thể hoàn tác."
        confirmLabel="Xóa"
        requireText="ws-lab-01"
        onConfirm={handleConfirm}
        onCancel={vi.fn()}
      />,
    );

    const confirmBtn = screen.getByRole('button', { name: 'Xóa' });
    expect(confirmBtn).toBeDisabled();

    const input = screen.getByLabelText('Gõ ws-lab-01 để xác nhận');
    await user.type(input, 'ws-lab-0');
    expect(confirmBtn).toBeDisabled();

    await user.type(input, '1');
    expect(confirmBtn).toBeEnabled();

    await user.click(confirmBtn);
    expect(handleConfirm).toHaveBeenCalledTimes(1);
  });

  it('input value is passed to onConfirm', async () => {
    const user = userEvent.setup();
    const handleConfirm = vi.fn();

    render(
      <ConfirmDialog
        open={true}
        title="Khóa thẻ"
        message="Lý do khóa thẻ:"
        confirmLabel="Khóa"
        input={{ label: 'Lý do', placeholder: 'Nhập lý do' }}
        onConfirm={handleConfirm}
        onCancel={vi.fn()}
      />,
    );

    const input = screen.getByLabelText('Lý do');
    await user.type(input, 'Thẻ bị mất');

    const confirmBtn = screen.getByRole('button', { name: 'Khóa' });
    await user.click(confirmBtn);

    expect(handleConfirm).toHaveBeenCalledWith('Thẻ bị mất');
  });

  it('a rejected onConfirm shows the error message inside and keeps the dialog open', async () => {
    const user = userEvent.setup();
    const handleConfirm = vi.fn().mockRejectedValue(new ApiError(400, 'FAIL', 'Lỗi từ chối thao tác'));

    render(
      <ConfirmDialog
        open={true}
        title="Thao tác thất bại"
        message="Nhấn xác nhận để thử lại"
        confirmLabel="Thực hiện"
        onConfirm={handleConfirm}
        onCancel={vi.fn()}
      />,
    );

    const confirmBtn = screen.getByRole('button', { name: 'Thực hiện' });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Lỗi từ chối thao tác');
    });

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
