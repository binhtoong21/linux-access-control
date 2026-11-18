import React, { useEffect, useId, useRef, useState } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { Field, inputClass } from './Field';
import { Notice } from './Notice';
import { errorMessage } from '../../lib/errors';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  tone?: 'default' | 'danger';
  onConfirm: (input?: string) => Promise<void> | void;
  onCancel: () => void;
  requireText?: string;
  input?: {
    label: string;
    placeholder?: string;
    maxLength?: number;
  };
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  tone = 'default',
  onConfirm,
  onCancel,
  requireText,
  input,
}: ConfirmDialogProps) {
  const [requireInput, setRequireInput] = useState('');
  const [freeInput, setFreeInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const requireInputId = useId();
  const freeInputId = useId();

  useEffect(() => {
    if (open) {
      setRequireInput('');
      setFreeInput('');
      setError(null);
      setLoading(false);
      inFlightRef.current = false;
    }
  }, [open]);

  const handleConfirm = async () => {
    if (inFlightRef.current) return;
    if (requireText && requireInput !== requireText) return;

    inFlightRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const arg = input ? freeInput : (requireText ? requireInput : undefined);
      await onConfirm(arg);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  };

  const isConfirmDisabled =
    loading || (Boolean(requireText) && requireInput !== requireText);

  return (
    <Dialog
      open={open}
      onClose={loading ? () => {} : onCancel}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            Hủy
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={handleConfirm}
            loading={loading}
            disabled={isConfirmDisabled}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Notice tone="danger">{error}</Notice>}

        <div className="text-sm text-ink">{message}</div>

        {input && (
          <Field label={input.label} htmlFor={freeInputId}>
            <input
              id={freeInputId}
              type="text"
              value={freeInput}
              onChange={(e) => setFreeInput(e.target.value)}
              placeholder={input.placeholder}
              maxLength={input.maxLength}
              disabled={loading}
              className={`w-full ${inputClass}`}
            />
          </Field>
        )}

        {requireText && (
          <Field label={`Gõ ${requireText} để xác nhận`} htmlFor={requireInputId}>
            <input
              id={requireInputId}
              type="text"
              value={requireInput}
              onChange={(e) => setRequireInput(e.target.value)}
              disabled={loading}
              className={`w-full ${inputClass}`}
            />
          </Field>
        )}
      </div>
    </Dialog>
  );
}
