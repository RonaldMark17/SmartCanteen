import { useEffect, useState } from 'react';
import { API } from '../services/api';
import DismissibleAlert from '../components/DismissibleAlert';
import {
  ArrowTrendingUpIcon,
  BuildingStorefrontIcon,
  CheckCircleIcon,
  EyeIcon,
  EyeSlashIcon,
  FingerPrintIcon,
  LockClosedIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';

const LOGIN_LOCKOUT_STORAGE_KEY = 'sc_login_lockouts';
const REMEMBERED_USERNAME_STORAGE_KEY = 'sc_remembered_username';
const MAX_LOGIN_ATTEMPTS = 3;
const LOGIN_LOCKOUT_MS = 60 * 1000;

const workspaceDetails = [
  {
    label: 'POS operations',
    description: 'Checkout flow, cart review, and receipt history.',
  },
  {
    label: 'Inventory control',
    description: 'Stock visibility, low-stock notices, and item review.',
  },
  {
    label: 'Demand planning',
    description: 'Forecasts, reminders, analytics, and prep signals.',
  },
  {
    label: 'Audit trail',
    description: 'Role-based actions and admin oversight.',
  },
];

const accessDetails = [
  { label: 'Roles', value: 'Cashier, Staff, Admin' },
  { label: 'Lockout', value: '3 failed attempts' },
  { label: 'Passkey', value: 'Chrome + Apple' },
];

function normalizeLoginIdentifier(value) {
  return String(value || '').trim().toLowerCase();
}

function readLoginLockouts(now = Date.now()) {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOGIN_LOCKOUT_STORAGE_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    let changed = false;
    const activeLockouts = {};
    Object.entries(parsed).forEach(([identifier, record]) => {
      const attempts = Number(record?.attempts || 0);
      const lockedUntil = Number(record?.lockedUntil || 0);

      if (lockedUntil > 0 && lockedUntil <= now) {
        changed = true;
        return;
      }

      if (attempts > 0 || lockedUntil > now) {
        activeLockouts[identifier] = { attempts, lockedUntil };
      }
    });

    if (changed) {
      localStorage.setItem(LOGIN_LOCKOUT_STORAGE_KEY, JSON.stringify(activeLockouts));
    }

    return activeLockouts;
  } catch {
    return {};
  }
}

function saveLoginLockouts(lockouts) {
  try {
    localStorage.setItem(LOGIN_LOCKOUT_STORAGE_KEY, JSON.stringify(lockouts));
  } catch {
    // Login lockout is a UI guard; keep sign-in usable if storage is unavailable.
  }
}

function getLoginLockoutState(identifier, now = Date.now()) {
  if (!identifier) {
    return {
      attempts: 0,
      isLocked: false,
      lockedUntil: 0,
      remainingAttempts: MAX_LOGIN_ATTEMPTS,
      remainingMs: 0,
    };
  }

  const record = readLoginLockouts(now)[identifier] || {};
  const lockedUntil = Number(record.lockedUntil || 0);
  const remainingMs = Math.max(0, lockedUntil - now);
  const isLocked = remainingMs > 0;
  const attempts = isLocked ? MAX_LOGIN_ATTEMPTS : Number(record.attempts || 0);

  return {
    attempts,
    isLocked,
    lockedUntil,
    remainingAttempts: Math.max(0, MAX_LOGIN_ATTEMPTS - attempts),
    remainingMs,
  };
}

function recordFailedLogin(identifier, now = Date.now()) {
  if (!identifier) {
    return getLoginLockoutState(identifier, now);
  }

  const lockouts = readLoginLockouts(now);
  const currentAttempts = Number(lockouts[identifier]?.attempts || 0);
  const attempts = Math.min(MAX_LOGIN_ATTEMPTS, currentAttempts + 1);
  const lockedUntil = attempts >= MAX_LOGIN_ATTEMPTS ? now + LOGIN_LOCKOUT_MS : 0;

  lockouts[identifier] = { attempts, lockedUntil };
  saveLoginLockouts(lockouts);

  return getLoginLockoutState(identifier, now);
}

function clearLoginLockout(identifier) {
  if (!identifier) {
    return;
  }

  const lockouts = readLoginLockouts();
  delete lockouts[identifier];
  saveLoginLockouts(lockouts);
}

function formatLockoutDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) {
    return `${seconds}s`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function isCredentialFailure(message) {
  return String(message || '').toLowerCase().includes('invalid username or password');
}

function getRememberedUsername() {
  try {
    return localStorage.getItem(REMEMBERED_USERNAME_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function getPortalLabel(identifier) {
  const value = normalizeLoginIdentifier(identifier);

  if (value.includes('admin')) {
    return 'Admin Portal';
  }

  if (value.includes('cashier') || value.includes('pos')) {
    return 'Cashier Portal';
  }

  if (value.includes('staff')) {
    return 'Staff Portal';
  }

  return 'Staff Portal';
}

export default function Login({ onLogin }) {
  const [username, setUsername] = useState(getRememberedUsername);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberUsername, setRememberUsername] = useState(() => Boolean(getRememberedUsername()));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lockoutNow, setLockoutNow] = useState(() => Date.now());
  const [passkeySetupPrompt, setPasskeySetupPrompt] = useState(null);
  const [passkeySetupLoading, setPasskeySetupLoading] = useState(false);

  const loginIdentifier = normalizeLoginIdentifier(username);
  const lockoutState = getLoginLockoutState(loginIdentifier, lockoutNow);
  const lockoutRemainingLabel = formatLockoutDuration(lockoutState.remainingMs);
  const portalLabel = getPortalLabel(username);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setLockoutNow(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const submittedUsername = username;
    const submittedPassword = password;
    const identifier = normalizeLoginIdentifier(submittedUsername);
    const currentLockoutState = getLoginLockoutState(identifier);

    if (currentLockoutState.isLocked) {
      setError('');
      setLockoutNow(Date.now());
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await API.login(submittedUsername.trim(), submittedPassword);
      clearLoginLockout(identifier);
      setLockoutNow(Date.now());
      if (rememberUsername) {
        localStorage.setItem(REMEMBERED_USERNAME_STORAGE_KEY, submittedUsername.trim());
      } else {
        localStorage.removeItem(REMEMBERED_USERNAME_STORAGE_KEY);
      }
      localStorage.setItem('sc_token', res.access_token);
      localStorage.setItem('sc_user', JSON.stringify(res.user));
      if (res.offline) {
        window.showToast?.('Signed in with offline access saved on this device.', 'warning');
      }
      if (res.passkey_enrollment_available && !res.offline && API.isPasskeySupported()) {
        setPasskeySetupPrompt({
          name: res.user?.full_name || res.user?.username || submittedUsername.trim(),
        });
        setPassword('');
        return;
      }
      onLogin();
    } catch (err) {
      setUsername(submittedUsername);
      setPassword(submittedPassword);

      const message = err.message || 'Invalid username or password';

      if (isCredentialFailure(message)) {
        const nextLockoutState = recordFailedLogin(identifier);
        setLockoutNow(Date.now());

        if (nextLockoutState.isLocked) {
          setError('');
        } else {
          const attemptLabel = nextLockoutState.remainingAttempts === 1 ? 'attempt' : 'attempts';
          setError(
            `${message}. ${nextLockoutState.remainingAttempts} ${attemptLabel} remaining before a 1-minute lock.`
          );
        }
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleUsernameChange = (event) => {
    setUsername(event.target.value);
    setError('');
    setPasskeySetupPrompt(null);
    setLockoutNow(Date.now());
  };

  const handlePasskeySetup = async () => {
    setPasskeySetupLoading(true);
    setError('');

    try {
      await API.registerCurrentDevicePasskey('SmartCanteen passkey');
      window.showToast?.('Passkey MFA is enabled for this account.', 'success');
      onLogin();
    } catch (err) {
      setError(err.message || 'Passkey setup failed. You can continue and try again later.');
    } finally {
      setPasskeySetupLoading(false);
    }
  };

  const handleContinueWithoutPasskey = () => {
    setPasskeySetupPrompt(null);
    onLogin();
  };

  return (
    <div className="relative h-[100dvh] overflow-hidden bg-slate-950 px-3 py-3 text-slate-100 sm:px-5 sm:py-4">
      <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px)] [background-size:44px_44px]" />
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-72 -translate-y-1/2 bg-[radial-gradient(ellipse_at_center,rgba(196,61,246,0.18),transparent_62%)]" />
      <div className="relative mx-auto flex h-full max-w-6xl items-center justify-center">
        <div className="grid max-h-full w-full overflow-hidden rounded-[28px] border border-slate-800 bg-slate-900 shadow-[0_28px_100px_rgba(0,0,0,0.52)] max-sm:h-full max-sm:rounded-[24px] max-sm:bg-slate-950/70 max-sm:shadow-[0_20px_70px_rgba(0,0,0,0.42)] lg:grid-cols-[20rem_minmax(0,1fr)]">
          <aside className="hidden min-h-0 flex-col border-r border-slate-800 bg-slate-950 p-5 lg:flex">
            <div className="flex items-center gap-3">
              <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-sm font-black text-white shadow-lg shadow-primary/40 ring-4 ring-primary/10">
                <span className="absolute inset-0 rounded-2xl bg-white/10 animate-pulse" />
                S
              </div>
              <div className="min-w-0">
                <div className="truncate text-xl font-black text-white">SmartCanteen</div>
                <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.22em] text-violet-300">
                  Operations Workspace
                </div>
              </div>
            </div>

            <div className="mt-6 rounded-[18px] border border-slate-800 bg-slate-900/70 p-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-200">
                <ShieldCheckIcon className="h-4 w-4" />
                Protected access
              </div>
              <h1 className="mt-3 text-2xl font-black leading-8 text-white">
                Secure access for daily service.
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-400 [@media(max-height:720px)]:hidden">
                Role-aware workspaces keep cashier, stock, forecasting, and audit tasks organized.
              </p>
            </div>

            <div className="mt-4 rounded-[18px] border border-slate-800 bg-slate-900/70 p-4 [@media(max-height:720px)]:hidden">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                    Today Preview
                  </div>
                  <div className="mt-1 text-sm font-black text-slate-100">Service dashboard</div>
                </div>
                <div className="rounded-full bg-emerald-400/10 p-2 text-emerald-300">
                  <ArrowTrendingUpIcon className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-4 flex h-24 items-end gap-2 rounded-[14px] border border-slate-800 bg-slate-950/70 px-3 py-3">
                {[38, 54, 46, 72, 58, 88, 66].map((height, index) => (
                  <div
                    key={height}
                    className={`w-full rounded-t-md ${
                      index === 5 ? 'bg-primary shadow-[0_0_18px_rgba(196,61,246,0.34)]' : 'bg-slate-700'
                    }`}
                    style={{ height: `${height}%` }}
                  />
                ))}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-[12px] bg-slate-950/70 px-2 py-1.5">
                  <div className="text-sm font-black text-white">85%</div>
                  <div className="text-[9px] font-black uppercase tracking-widest text-slate-500">Model</div>
                </div>
                <div className="rounded-[12px] bg-slate-950/70 px-2 py-1.5">
                  <div className="text-sm font-black text-white">4</div>
                  <div className="text-[9px] font-black uppercase tracking-widest text-slate-500">Alerts</div>
                </div>
                <div className="rounded-[12px] bg-slate-950/70 px-2 py-1.5">
                  <div className="text-sm font-black text-white">Live</div>
                  <div className="text-[9px] font-black uppercase tracking-widest text-slate-500">Sync</div>
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 [@media(max-height:720px)]:hidden">
              <div className="rounded-[14px] border border-slate-800 bg-slate-900/70 px-3 py-2">
                <div className="text-lg font-black text-white">3</div>
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Roles</div>
              </div>
              <div className="rounded-[14px] border border-slate-800 bg-slate-900/70 px-3 py-2">
                <div className="text-lg font-black text-white">24/7</div>
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Audit</div>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {workspaceDetails.map((item) => (
                <div
                  key={item.label}
                  className="rounded-[14px] border border-slate-800 bg-slate-900/70 px-3 py-2"
                >
                  <div className="flex items-center gap-2 text-xs font-black text-slate-200">
                    <CheckCircleIcon className="h-4 w-4 shrink-0 text-emerald-400" />
                    {item.label}
                  </div>
                  <div className="mt-1 pl-6 text-[11px] font-medium leading-5 text-slate-500 [@media(max-height:790px)]:hidden">
                    {item.description}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-[18px] border border-slate-800 bg-slate-900/70 p-4 [@media(max-height:780px)]:hidden">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Service Snapshot
                  </div>
                  <div className="mt-1 text-2xl font-black text-white">PHP 12,540</div>
                  <div className="mt-1 text-xs font-bold text-emerald-300">+8% vs yesterday</div>
                </div>
                <div className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-200">
                  Online
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-bold text-slate-400">
                <div className="rounded-[12px] bg-slate-950/70 px-2.5 py-2">
                  <div className="text-slate-500">System Status</div>
                  <div className="mt-0.5 text-slate-200">Online</div>
                </div>
                <div className="rounded-[12px] bg-slate-950/70 px-2.5 py-2">
                  <div className="text-slate-500">Last Sync</div>
                  <div className="mt-0.5 text-slate-200">2 mins ago</div>
                </div>
              </div>
            </div>

            <div className="mt-auto pt-3 text-[11px] font-bold text-slate-600 [@media(max-height:720px)]:hidden">
              SmartCanteen - Secure Staff Access
            </div>
          </aside>

          <section className="flex min-h-0 items-center justify-center bg-slate-900/95 px-4 py-4 max-sm:h-full max-sm:bg-transparent max-sm:px-2 max-sm:py-2 sm:px-8 sm:py-5 lg:px-10">
            <div className="w-full max-w-md rounded-[24px] border border-slate-800 bg-slate-950/70 p-4 shadow-[0_18px_55px_rgba(0,0,0,0.28)] max-sm:flex max-sm:h-full max-sm:flex-col max-sm:justify-center max-sm:border-slate-800/90 max-sm:bg-slate-950/80 max-sm:p-4 sm:p-5">
              <div className="mb-4 flex items-center gap-3 lg:hidden">
                <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-base font-black text-white shadow-lg shadow-primary/40 ring-4 ring-primary/10 sm:h-10 sm:w-10 sm:text-sm">
                  <span className="absolute inset-0 rounded-2xl bg-white/10 animate-pulse" />
                  S
                </div>
                <div className="min-w-0">
                  <div className="truncate text-xl font-black text-white sm:text-lg">SmartCanteen</div>
                  <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-violet-300">
                    Operations Workspace
                  </div>
                </div>
              </div>

              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                    <BuildingStorefrontIcon className="h-4 w-4" />
                    {portalLabel}
                  </div>
                  <h2 className="mt-3 text-2xl font-black leading-8 text-slate-100 sm:text-3xl sm:leading-9">
                    Welcome back to SmartCanteen
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-slate-400 [@media(max-height:650px)]:hidden">
                    Ready for today&apos;s service?
                  </p>
                </div>
                <div className="hidden rounded-[14px] border border-slate-800 bg-slate-900 p-2 text-violet-200 sm:block">
                  <ShieldCheckIcon className="h-5 w-5" />
                </div>
              </div>

              <div className="mt-3 space-y-2">
                <div className="grid grid-cols-2 gap-2 [@media(max-height:680px)]:hidden">
                  <div className="flex items-center justify-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1.5 text-[10px] font-black text-emerald-200 sm:justify-start sm:px-3 sm:text-[11px]">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.12)]" />
                    Secure
                  </div>
                  <div className="flex items-center justify-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[10px] font-black text-slate-300 sm:justify-start sm:px-3 sm:text-[11px]">
                    <LockClosedIcon className="h-4 w-4 text-violet-300" />
                    Encrypted
                  </div>
                </div>
                {lockoutState.isLocked && (
                  <div className="rounded-[14px] border border-amber-400/30 bg-amber-500/10 px-4 py-2.5 text-sm leading-6 text-amber-100">
                    <div className="font-black">Too many failed attempts</div>
                    <div className="mt-1">
                      This account is temporarily locked. Try again in {lockoutRemainingLabel}.
                    </div>
                  </div>
                )}
                {error && (
                  <DismissibleAlert
                    resetKey={error}
                    tone="red"
                    title="Sign-in issue"
                    className="rounded-[14px] border-red-400/30 bg-red-950/40 text-red-100"
                  >
                    {error}
                  </DismissibleAlert>
                )}
              </div>

              {passkeySetupPrompt ? (
                <div className="mt-4 space-y-3 rounded-[18px] border border-emerald-400/25 bg-emerald-400/10 p-4">
                  <div className="flex items-start gap-3">
                    <div className="rounded-2xl bg-emerald-400/15 p-2 text-emerald-200">
                      <FingerPrintIcon className="h-6 w-6" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-black text-emerald-100">Add passkey MFA</div>
                      <div className="mt-1 text-xs leading-5 text-emerald-50/80">
                        Secure {passkeySetupPrompt.name} with a Chrome passkey or Apple Passwords passkey.
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handlePasskeySetup}
                    disabled={passkeySetupLoading}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-4 py-3.5 text-sm font-black text-emerald-950 shadow-[0_14px_34px_rgba(52,211,153,0.28)] transition hover:-translate-y-0.5 hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                  >
                    {passkeySetupLoading ? (
                      <span className="flex items-center gap-2">
                        <span className="h-4 w-4 rounded-full border-2 border-emerald-950/30 border-t-emerald-950 animate-spin" />
                        Opening passkey...
                      </span>
                    ) : (
                      'Set Up Passkey'
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleContinueWithoutPasskey}
                    disabled={passkeySetupLoading}
                    className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm font-black text-slate-300 transition hover:border-slate-500 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Continue Without Passkey
                  </button>
                </div>
              ) : (
              <form onSubmit={handleSubmit} className="mt-4 space-y-4 sm:space-y-3.5">
                <label className="block">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Username
                  </span>
                  <input
                    type="text"
                    required
                    placeholder="Enter your username"
                    className="mt-1.5 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3.5 text-base font-medium text-slate-100 outline-none transition duration-200 placeholder:text-slate-600 focus:border-fuchsia-400 focus:bg-slate-950 focus:ring-2 focus:ring-fuchsia-400/25 focus:shadow-[0_0_0_4px_rgba(168,85,247,0.18),0_14px_30px_rgba(0,0,0,0.28)] disabled:cursor-not-allowed disabled:opacity-60 sm:py-3 sm:text-sm"
                    value={username}
                    onChange={handleUsernameChange}
                    disabled={loading}
                    autoComplete="username"
                  />
                </label>

                <label className="block">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Password
                  </span>
                  <div className="relative mt-1.5">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      placeholder="Enter your password"
                      className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3.5 pr-14 text-base font-medium text-slate-100 outline-none transition duration-200 placeholder:text-slate-600 focus:border-fuchsia-400 focus:bg-slate-950 focus:ring-2 focus:ring-fuchsia-400/25 focus:shadow-[0_0_0_4px_rgba(168,85,247,0.18),0_14px_30px_rgba(0,0,0,0.28)] disabled:cursor-not-allowed disabled:opacity-60 sm:py-3 sm:text-sm"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={loading}
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute inset-y-0 right-2 inline-flex h-full w-12 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-800 hover:text-slate-200"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeSlashIcon className="h-7 w-7" /> : <EyeIcon className="h-7 w-7" />}
                    </button>
                  </div>
                </label>

                <div className="flex items-center justify-between gap-3 text-xs">
                  <label className="flex items-center gap-2 font-bold text-slate-400">
                    <input
                      type="checkbox"
                      checked={rememberUsername}
                      onChange={(event) => setRememberUsername(event.target.checked)}
                      className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-primary focus:ring-2 focus:ring-primary/30"
                    />
                    Remember me
                  </label>
                </div>

                <div className="hidden items-start gap-2 rounded-[14px] border border-slate-800 bg-slate-900/70 px-3 py-2.5 sm:flex [@media(max-height:650px)]:hidden">
                  <FingerPrintIcon className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
                  <div className="text-xs leading-5 text-slate-400">
                    <span className="font-black text-slate-100">Passkey MFA:</span> Chrome passkeys and Apple Passwords work after setup.
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || lockoutState.isLocked || !username || !password}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#f35cff,#a855f7,#6d28d9)] px-4 py-[1.125rem] text-base font-black text-white shadow-[0_18px_42px_rgba(168,85,247,0.48)] transition duration-200 hover:-translate-y-1 hover:shadow-[0_24px_58px_rgba(168,85,247,0.58)] active:translate-y-0 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-[0_18px_42px_rgba(168,85,247,0.48)] sm:py-4 sm:text-sm"
                >
                  {lockoutState.isLocked ? (
                    `Try again in ${lockoutRemainingLabel}`
                  ) : loading ? (
                    <span className="flex items-center gap-2">
                      <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                      Authenticating...
                    </span>
                  ) : (
                    'Sign In'
                  )}
                </button>
              </form>
              )}

              <div className="mt-4 hidden gap-2 md:grid md:grid-cols-3 [@media(max-height:780px)]:hidden">
                {accessDetails.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-[14px] border border-slate-800 bg-slate-900/70 px-3 py-2"
                  >
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                      {item.label}
                    </div>
                    <div className="mt-1 text-xs font-bold leading-5 text-slate-200">
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 text-center text-[11px] font-bold text-slate-600 [@media(max-height:650px)]:hidden">
                SmartCanteen - Secure Staff Access
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
