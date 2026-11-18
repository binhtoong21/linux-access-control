import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className = '',
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const id = useId();
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;

  useEffect(() => {
    if (!open) return;
    previousActiveElementRef.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    if (panel) {
      const focusables = panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusables.length > 0) {
        focusables[0].focus();
      } else {
        panel.focus();
      }
    }

    return () => {
      previousActiveElementRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === 'Tab') {
        const panel = panelRef.current;
        if (!panel) return;

        const focusables = Array.from(
          panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        );

        if (focusables.length === 0) {
          e.preventDefault();
          panel.focus();
          return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first || document.activeElement === panel) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last || document.activeElement === panel) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      data-testid="dialog-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(27,34,32,0.4)]"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`bg-surface rounded-dialog shadow-md max-w-[480px] w-full p-5 outline-none space-y-4 ${className}`}
      >
        <div>
          <h2 id={titleId} className="text-base font-semibold text-ink">
            {title}
          </h2>
          {description && (
            <p id={descId} className="text-sm text-ink-muted mt-1">
              {description}
            </p>
          )}
        </div>

        <div>{children}</div>

        {footer && <div className="flex justify-end gap-2 pt-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
