import { useState } from 'react';
import { API } from '../services/api';
import DismissibleAlert from '../components/DismissibleAlert';
import {
  ArrowTrendingUpIcon,
  BellAlertIcon,
  BuildingStorefrontIcon,
  CheckCircleIcon,
  CloudArrowUpIcon,
  EyeIcon,
  EyeSlashIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import { Skeleton } from '../components/Skeleton';

const highlights = [
  {
    title: 'Forecast with confidence',
    description: 'Review demand signals, weather-informed predictions, and smarter restock priorities before the rush starts.',
    Icon: ArrowTrendingUpIcon,
  },
  {
    title: 'Stay ready offline',
    description: 'Cashier workflows and saved device access help the team keep moving when connectivity becomes unreliable.',
    Icon: CloudArrowUpIcon,
  },
  {
    title: 'Keep stock in control',
    description: 'Monitor low-stock alerts, audit activity, and daily movement from one focused workspace.',
    Icon: BellAlertIcon,
  },
];

const quickFacts = [
  { label: 'Workspaces', value: 'POS, Inventory, Forecasting' },
  { label: 'Roles', value: 'Cashier, Staff, Admin' },
  { label: 'Access', value: 'Device-aware offline sign-in' },
];

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [seedMessage, setSeedMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await API.login(username, password);
      localStorage.setItem('sc_token', res.access_token);
      localStorage.setItem('sc_user', JSON.stringify(res.user));
      if (res.offline) {
        window.showToast?.('Signed in with offline access saved on this device.', 'warning');
      }
      onLogin();
    } catch (err) {
      setError(err.message || 'Invalid username or password');
    } finally {
      setLoading(false);
    }
  };

  const handleSeed = async () => {
    try {
      const data = await API.seed();
      setSeedMessage(data?.message || 'Demo data initialized successfully!');
      setTimeout(() => setSeedMessage(''), 4000);
    } catch {
      setError('Failed to seed database. Is the backend running?');
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 p-4 sm:p-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.18),_transparent_24%),radial-gradient(circle_at_top_right,_rgba(251,191,36,0.16),_transparent_22%),radial-gradient(circle_at_bottom_left,_rgba(236,72,153,0.14),_transparent_24%)]" />

      <div className="relative mx-auto flex min-h-[calc(100vh-2rem)] max-w-6xl items-center sm:min-h-[calc(100vh-3rem)]">
        <div className="grid w-full overflow-hidden rounded-[32px] border border-white/10 bg-white shadow-[0_30px_120px_rgba(15,23,42,0.45)] lg:grid-cols-[minmax(0,1.1fr)_430px]">
          <section className="relative overflow-hidden bg-slate-950 px-6 py-8 text-white sm:px-8 sm:py-10 lg:px-10 lg:py-12">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.16),_transparent_34%),radial-gradient(circle_at_bottom_right,_rgba(251,191,36,0.18),_transparent_28%)]" />

            <div className="relative">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/8 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.28em] text-cyan-100">
                <SparklesIcon className="h-4 w-4" />
                SmartCanteen AI
              </div>

              <div className="mt-5 max-w-2xl">
                <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl lg:text-[2.8rem] lg:leading-[1.05]">
                  Run your canteen with smarter stock, sharper forecasts, and faster daily decisions.
                </h1>
                <p className="mt-4 max-w-xl text-sm leading-7 text-slate-300 sm:text-base">
                  Bring together POS activity, inventory monitoring, and AI-assisted demand planning in one place that works for busy teams.
                </p>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                {quickFacts.map((fact) => (
                  <div
                    key={fact.label}
                    className="rounded-2xl border border-white/10 bg-white/8 px-4 py-4 backdrop-blur"
                  >
                    <div className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">
                      {fact.label}
                    </div>
                    <div className="mt-2 text-sm font-bold text-white">{fact.value}</div>
                  </div>
                ))}
              </div>

              <div className="mt-6 grid gap-3">
                {highlights.map(({ title, description, Icon }) => (
                  <div
                    key={title}
                    className="rounded-[24px] border border-white/10 bg-white/8 p-4 backdrop-blur transition hover:bg-white/10"
                  >
                    <div className="flex items-start gap-4">
                      <div className="rounded-2xl border border-white/10 bg-white/10 p-3 text-cyan-100">
                        <Icon className="h-6 w-6" />
                      </div>
                      <div>
                        <div className="text-base font-black text-white">{title}</div>
                        <div className="mt-2 text-sm leading-6 text-slate-300">{description}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 rounded-[28px] border border-cyan-400/20 bg-[linear-gradient(135deg,_rgba(34,211,238,0.16),_rgba(15,23,42,0.12))] p-5">
                <div className="flex items-start gap-3">
                  <div className="rounded-2xl bg-white/10 p-3 text-cyan-100">
                    <ShieldCheckIcon className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="text-sm font-black uppercase tracking-[0.24em] text-cyan-100">
                      Team Access
                    </div>
                    <div className="mt-2 text-lg font-black text-white">
                      Sign in once online to enable offline login on this device.
                    </div>
                    <div className="mt-2 text-sm leading-6 text-slate-300">
                      Helpful for cashier stations and mobile devices that need reliable access during unstable network periods.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="bg-white px-6 py-8 sm:px-8 sm:py-10">
            <div className="mx-auto flex h-full max-w-md flex-col">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.24em] text-slate-600">
                  <BuildingStorefrontIcon className="h-4 w-4" />
                  Secure Login
                </div>
                <h2 className="mt-4 text-3xl font-black tracking-tight text-slate-900">
                  Welcome back
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Sign in to access live operations, analytics, and stock planning tools for your team.
                </p>
              </div>

              <div className="mt-6 space-y-3">
                {error && (
                  <DismissibleAlert resetKey={error} tone="red" title="Sign-in issue">
                    {error}
                  </DismissibleAlert>
                )}
                {seedMessage && (
                  <DismissibleAlert resetKey={seedMessage} tone="emerald" title="Demo data ready">
                    {seedMessage}
                  </DismissibleAlert>
                )}
              </div>

              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                <label className="block">
                  <span className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">
                    Username
                  </span>
                  <input
                    type="text"
                    required
                    placeholder="Enter your username"
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm font-medium text-slate-700 outline-none transition focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={loading}
                    autoComplete="username"
                  />
                </label>

                <label className="block">
                  <span className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">
                    Password
                  </span>
                  <div className="relative mt-2">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      placeholder="Enter your password"
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 pr-14 text-sm font-medium text-slate-700 outline-none transition focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={loading}
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute inset-y-0 right-3 inline-flex items-center text-slate-400 transition hover:text-slate-600"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                    </button>
                  </div>
                </label>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="flex items-start gap-3">
                    <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
                    <div>
                      <div className="text-sm font-bold text-slate-900">Offline-ready access</div>
                      <div className="mt-1 text-sm leading-6 text-slate-500">
                        After one successful online sign-in, this device can reuse saved access when the network is unavailable.
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || !username || !password}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-4 text-sm font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <Skeleton className="h-4 w-16 rounded-md bg-white/35" />
                      Signing in...
                    </span>
                  ) : (
                    'Sign In to Workspace'
                  )}
                </button>
              </form>

              <div className="mt-6 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                <div className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">
                  First-time setup
                </div>
                <div className="mt-2 text-sm leading-6 text-slate-600">
                  Need sample inventory, users, and forecast-ready demo activity for testing the app?
                </div>
                <button
                  onClick={handleSeed}
                  type="button"
                  className="mt-3 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700 transition hover:border-primary hover:text-primary"
                >
                  <SparklesIcon className="h-4 w-4" />
                  Initialize demo data
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
