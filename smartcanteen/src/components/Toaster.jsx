import { useEffect, useRef, useState } from 'react';
import { 
  CheckCircleIcon, 
  ExclamationTriangleIcon, 
  XCircleIcon, 
  InformationCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

export default function Toaster() {
  const [toasts, setToasts] = useState([]);
  const timeoutIdsRef = useRef(new Map());

  const removeToast = (id) => {
    const timeoutId = timeoutIdsRef.current.get(id);
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      timeoutIdsRef.current.delete(id);
    }

    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  useEffect(() => {
    window.showToast = (message, type = 'info') => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToasts((prev) => [...prev, { id, message, type }]);

      const timeoutId = window.setTimeout(() => {
        removeToast(id);
      }, 3000);

      timeoutIdsRef.current.set(id, timeoutId);
    };

    return () => {
      timeoutIdsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      timeoutIdsRef.current.clear();
      delete window.showToast;
    };
  }, []);

  const icons = {
    success: <CheckCircleIcon className="w-6 h-6 text-emerald-500" />,
    error: <XCircleIcon className="w-6 h-6 text-red-500" />,
    warning: <ExclamationTriangleIcon className="w-6 h-6 text-amber-500" />,
    info: <InformationCircleIcon className="w-6 h-6 text-blue-500" />
  };

  const backgrounds = {
    success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    error: 'bg-red-50 border-red-200 text-red-800',
    warning: 'bg-amber-50 border-amber-200 text-amber-800',
    info: 'bg-blue-50 border-blue-200 text-blue-800'
  };

  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[9999] flex flex-col gap-3 sm:inset-x-auto sm:bottom-6 sm:right-6">
      {toasts.map((toast) => (
        <div 
          key={toast.id} 
          className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg shadow-slate-900/5 animate-in slide-in-from-right-8 fade-in duration-300 sm:min-w-[280px] ${backgrounds[toast.type]}`}
        >
          <div className="shrink-0">{icons[toast.type]}</div>
          <span className="min-w-0 flex-1 text-sm font-bold">{toast.message}</span>
          <button
            type="button"
            onClick={() => removeToast(toast.id)}
            aria-label="Dismiss notification"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition hover:bg-white/70"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
