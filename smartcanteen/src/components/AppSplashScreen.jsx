import { useEffect, useState } from 'react';
import BrandLogo from './BrandLogo';

const STAGES = [
  { progress: 15, message: 'Initializing application runtime...' },
  { progress: 45, message: 'Connecting to database server...' },
  { progress: 80, message: 'Loading modules & offline cache...' },
  { progress: 100, message: 'Starting workspace...' },
];

export default function AppSplashScreen({ onFinished }) {
  const [stageIndex, setStageIndex] = useState(0);
  const [progress, setProgress] = useState(10);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => {
      setStageIndex(1);
      setProgress(45);
    }, 280);

    const t2 = setTimeout(() => {
      setStageIndex(2);
      setProgress(85);
    }, 650);

    const t3 = setTimeout(() => {
      setStageIndex(3);
      setProgress(100);
    }, 1050);

    const t4 = setTimeout(() => {
      setFading(true);
    }, 1300);

    const t5 = setTimeout(() => {
      if (typeof onFinished === 'function') {
        onFinished();
      }
    }, 1500);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      clearTimeout(t5);
    };
  }, [onFinished]);

  const currentStage = STAGES[stageIndex] || STAGES[0];

  return (
    <div
      className={`fixed inset-0 z-[999] flex flex-col items-center justify-center bg-slate-950 text-slate-100 select-none transition-opacity duration-300 ${
        fading ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      {/* Background ambient lighting */}
      <div className="absolute -top-32 left-1/2 -translate-x-1/2 h-96 w-96 rounded-full bg-emerald-500/15 blur-[100px] pointer-events-none" />
      <div className="absolute -bottom-32 left-1/2 -translate-x-1/2 h-96 w-96 rounded-full bg-teal-500/10 blur-[120px] pointer-events-none" />

      {/* Main Container */}
      <div className="relative z-10 flex flex-col items-center max-w-sm px-6 text-center animate-in fade-in zoom-in-95 duration-500">
        {/* Animated Brand Logo with glowing aura */}
        <div className="relative mb-6">
          <div className="absolute -inset-4 rounded-3xl bg-emerald-500/20 blur-xl animate-pulse" />
          <div className="relative flex h-24 w-24 items-center justify-center rounded-3xl border border-emerald-500/30 bg-slate-900/90 p-4 shadow-2xl backdrop-blur-md">
            <BrandLogo className="h-16 w-16 drop-shadow-[0_0_12px_rgba(16,185,129,0.5)]" />
          </div>
        </div>

        {/* Title */}
        <h1 className="text-3xl font-black tracking-tight bg-gradient-to-r from-white via-slate-100 to-emerald-400 bg-clip-text text-transparent">
          MEALS
        </h1>
        <p className="mt-1 text-xs font-semibold tracking-wider uppercase text-emerald-400">
          Smart Canteen System
        </p>

        {/* Progress Bar */}
        <div className="mt-8 w-64">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800 border border-slate-700/60 shadow-inner">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-300 ease-out shadow-[0_0_10px_rgba(52,211,153,0.8)]"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Dynamic Status Text */}
          <div className="mt-3 flex items-center justify-center gap-2 text-xs font-medium text-slate-400">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="transition-all duration-200">{currentStage.message}</span>
          </div>
        </div>
      </div>

      {/* Footer Version Tag */}
      <div className="absolute bottom-6 text-[11px] font-mono font-medium text-slate-600">
        v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.1.0'} • Desktop Edition
      </div>
    </div>
  );
}
