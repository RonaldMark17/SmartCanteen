import React, { useEffect } from 'react';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  PencilSquareIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

/**
 * ConfirmationModal
 *
 * A reusable, accessible confirmation dialog for save/edit/delete actions.
 * Displays a clear title, description, optional field details, and primary/cancel actions.
 */
export default function ConfirmationModal({
  isOpen,
  title = 'Confirm Changes',
  message = 'Are you sure you want to confirm and save these changes?',
  confirmLabel = 'Yes, Save Changes',
  cancelLabel = 'Cancel',
  tone = 'emerald', // 'emerald' | 'indigo' | 'amber' | 'rose' | 'slate'
  icon: CustomIcon,
  isLoading = false,
  loadingText = 'Saving...',
  details = null,
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !isLoading) {
        onCancel?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isLoading, onCancel]);

  if (!isOpen) return null;

  const toneStyles = {
    emerald: {
      iconBg: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400',
      border: 'border-emerald-200/80 dark:border-emerald-900/60',
      btn: 'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white focus:ring-emerald-500',
      defaultIcon: CheckCircleIcon,
    },
    indigo: {
      iconBg: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400',
      border: 'border-indigo-200/80 dark:border-indigo-900/60',
      btn: 'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white focus:ring-indigo-500',
      defaultIcon: PencilSquareIcon,
    },
    amber: {
      iconBg: 'bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400',
      border: 'border-amber-200/80 dark:border-amber-900/60',
      btn: 'bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white focus:ring-amber-500',
      defaultIcon: ExclamationTriangleIcon,
    },
    rose: {
      iconBg: 'bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400',
      border: 'border-rose-200/80 dark:border-rose-900/60',
      btn: 'bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white focus:ring-rose-500',
      defaultIcon: ExclamationTriangleIcon,
    },
    slate: {
      iconBg: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
      border: 'border-slate-200 dark:border-slate-800',
      btn: 'bg-slate-900 hover:bg-slate-800 active:bg-slate-950 dark:bg-slate-100 dark:hover:bg-white dark:text-slate-900 text-white',
      defaultIcon: InformationCircleIcon,
    },
  };

  const currentTone = toneStyles[tone] || toneStyles.emerald;
  const DisplayIcon = CustomIcon || currentTone.defaultIcon;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${currentTone.iconBg}`}>
              <DisplayIcon className="h-5 w-5 stroke-[2]" />
            </div>
            <div>
              <h3 id="confirm-modal-title" className="text-base font-black text-slate-900 dark:text-white">
                {title}
              </h3>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">
                {message}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300 disabled:opacity-40"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Optional Details Box */}
        {details && (
          <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-800/60 space-y-2 text-xs">
            {Array.isArray(details) ? (
              details.map((item, index) => (
                <div key={index} className="flex justify-between items-center gap-2">
                  <span className="font-bold text-slate-500 dark:text-slate-400 shrink-0">
                    {item.label}:
                  </span>
                  <span
                    className={`font-mono text-right truncate max-w-[240px] ${
                      item.highlight
                        ? 'font-black text-emerald-600 dark:text-emerald-400'
                        : 'font-bold text-slate-900 dark:text-white'
                    }`}
                  >
                    {item.value}
                  </span>
                </div>
              ))
            ) : (
              details
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-black text-slate-700 transition hover:bg-slate-100 active:scale-95 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={`inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-xs font-black shadow-xs transition active:scale-95 disabled:opacity-50 ${currentTone.btn}`}
          >
            {isLoading ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                {loadingText}
              </>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
