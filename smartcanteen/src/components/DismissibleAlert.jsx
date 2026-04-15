import { useEffect, useState } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';

const TONE_STYLES = {
  amber: {
    container: 'border-amber-200 bg-amber-50 text-amber-800',
    button: 'text-amber-500 hover:bg-amber-100 hover:text-amber-700',
  },
  red: {
    container: 'border-red-200 bg-red-50 text-red-700',
    button: 'text-red-500 hover:bg-red-100 hover:text-red-700',
  },
  sky: {
    container: 'border-sky-200 bg-sky-50 text-sky-800',
    button: 'text-sky-500 hover:bg-sky-100 hover:text-sky-700',
  },
  emerald: {
    container: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    button: 'text-emerald-500 hover:bg-emerald-100 hover:text-emerald-700',
  },
  slate: {
    container: 'border-slate-200 bg-slate-50 text-slate-700',
    button: 'text-slate-500 hover:bg-slate-200 hover:text-slate-700',
  },
};

export default function DismissibleAlert({
  resetKey,
  tone = 'amber',
  title,
  icon: Icon,
  className = '',
  children,
}) {
  const [dismissed, setDismissed] = useState(false);
  const styles = TONE_STYLES[tone] || TONE_STYLES.amber;

  useEffect(() => {
    setDismissed(false);
  }, [resetKey]);

  if (dismissed) {
    return null;
  }

  return (
    <div
      className={`flex items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-sm ${styles.container} ${className}`}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {Icon ? <Icon className="mt-0.5 h-5 w-5 shrink-0" /> : null}
        <div className="min-w-0 flex-1">
          {title ? <div className="font-bold">{title}</div> : null}
          <div className={title ? 'mt-1' : ''}>{children}</div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss alert"
        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition ${styles.button}`}
      >
        <XMarkIcon className="h-4 w-4" />
      </button>
    </div>
  );
}
