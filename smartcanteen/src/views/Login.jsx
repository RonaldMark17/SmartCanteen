import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { API } from '../services/api';
import { safeLocalStorageSetItem, safeLocalStorageSetJson } from '../services/storage';
import BrandLogo from '../components/BrandLogo';
import DismissibleAlert from '../components/DismissibleAlert';
import {
  BuildingStorefrontIcon,
  CheckCircleIcon,
  EyeIcon,
  EyeSlashIcon,
  LockClosedIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';

const LOGIN_LOCKOUT_STORAGE_KEY = 'sc_login_lockouts';
const REMEMBERED_USERNAME_STORAGE_KEY = 'sc_remembered_username';
const MAX_LOGIN_ATTEMPTS = 3;
const LOGIN_LOCKOUT_MS = 60 * 1000;
const RECOVERY_CODE_LENGTH = 12;

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
  { label: 'MFA', value: 'Authenticator app' },
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

function normalizeRecoveryCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, RECOVERY_CODE_LENGTH);
}

function formatRecoveryCode(value) {
  const normalized = normalizeRecoveryCode(value);
  return normalized.match(/.{1,4}/g)?.join('-') || '';
}

function normalizeAuthenticatorCode(value, { setup = false } = {}) {
  const normalized = normalizeRecoveryCode(value);
  if (setup || /^\d*$/.test(normalized)) {
    return normalized.replace(/\D/g, '').slice(0, 6);
  }

  return formatRecoveryCode(normalized);
}

function isAuthenticatorCodeReady(value, { setup = false } = {}) {
  const normalized = normalizeRecoveryCode(value);
  if (setup) {
    return /^\d{6}$/.test(normalized);
  }

  return /^\d{6}$/.test(normalized) || normalized.length === RECOVERY_CODE_LENGTH;
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

function persistAuthenticatedSession(accessToken, user) {
  const quotaMessage =
    'This device is out of browser storage. SmartCanteen cleared temporary cache, but there is still not enough space to save your session. Clear site data for this app and try again.';

  safeLocalStorageSetItem('sc_token', accessToken, { quotaMessage });

  try {
    safeLocalStorageSetJson('sc_user', user, {
      protectedKeys: ['sc_token'],
      quotaMessage,
    });
  } catch (error) {
    localStorage.removeItem('sc_token');
    throw error;
  }
}

export default function Login({ onLogin }) {
  const [username, setUsername] = useState(getRememberedUsername);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberUsername, setRememberUsername] = useState(() => Boolean(getRememberedUsername()));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [authenticatorChallenge, setAuthenticatorChallenge] = useState(null);
  const [authenticatorCode, setAuthenticatorCode] = useState('');
  const [authenticatorQrCode, setAuthenticatorQrCode] = useState('');
  const [secretCopied, setSecretCopied] = useState(false);
  const [lockoutNow, setLockoutNow] = useState(() => Date.now());
  const [pendingRecoveryCodes, setPendingRecoveryCodes] = useState([]);
  const [pendingLoginResult, setPendingLoginResult] = useState(null);
  const [recoveryCodesCopied, setRecoveryCodesCopied] = useState(false);
  const authenticatorCodeRef = useRef(null);

  const loginIdentifier = normalizeLoginIdentifier(username);
  const lockoutState = getLoginLockoutState(loginIdentifier, lockoutNow);
  const lockoutRemainingLabel = formatLockoutDuration(lockoutState.remainingMs);
  const portalLabel = getPortalLabel(username);
  const isAuthenticatorStep = Boolean(authenticatorChallenge);
  const isAuthenticatorSetup = authenticatorChallenge?.mfa_type === 'authenticator_setup';
  const canSubmitAuthenticatorCode = isAuthenticatorCodeReady(authenticatorCode, {
    setup: isAuthenticatorSetup,
  });

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setLockoutNow(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    let active = true;
    const otpUrl = authenticatorChallenge?.authenticator?.otpauth_url;

    if (!otpUrl) {
      setAuthenticatorQrCode('');
      return () => {
        active = false;
      };
    }

    QRCode.toDataURL(otpUrl, {
      margin: 1,
      width: 176,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then((dataUrl) => {
        if (active) {
          setAuthenticatorQrCode(dataUrl);
        }
      })
      .catch(() => {
        if (active) {
          setAuthenticatorQrCode('');
        }
      });

    return () => {
      active = false;
    };
  }, [authenticatorChallenge]);

  useEffect(() => {
    if (!isAuthenticatorStep) {
      return;
    }

    const focusTimer = window.setTimeout(() => {
      authenticatorCodeRef.current?.focus();
    }, 80);

    return () => window.clearTimeout(focusTimer);
  }, [isAuthenticatorStep]);

  const finishSuccessfulLogin = (res, submittedUsername, identifier) => {
    clearLoginLockout(identifier);
    setLockoutNow(Date.now());
    if (rememberUsername) {
      try {
        safeLocalStorageSetItem(REMEMBERED_USERNAME_STORAGE_KEY, submittedUsername.trim());
      } catch {
        // Remembered username is optional and should not block sign-in.
      }
    } else {
      localStorage.removeItem(REMEMBERED_USERNAME_STORAGE_KEY);
    }
    persistAuthenticatedSession(res.access_token, res.user);
    setAuthenticatorChallenge(null);
    setAuthenticatorCode('');
    setPendingRecoveryCodes([]);
    setPendingLoginResult(null);
    setRecoveryCodesCopied(false);
    if (res.offline) {
      window.showToast?.('Signed in with offline access saved on this device.', 'warning');
    }
    onLogin();
  };

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
      const res = authenticatorChallenge
        ? await API.verifyAuthenticatorLogin(
            authenticatorChallenge.mfa_token,
            authenticatorCode,
            submittedPassword,
            {
              rememberDevice: rememberUsername,
              username: submittedUsername.trim(),
            }
          )
        : await API.login(submittedUsername.trim(), submittedPassword, {
            rememberDevice: rememberUsername,
          });

      if (res?.mfa_required && !res?.access_token) {
        setAuthenticatorChallenge(res);
        setAuthenticatorCode('');
        setSecretCopied(false);
        setLoading(false);
        return;
      }

      const recoveryCodes = Array.isArray(res?.recovery_codes) ? res.recovery_codes : [];
      if (recoveryCodes.length > 0) {
        setAuthenticatorChallenge(null);
        setAuthenticatorCode('');
        setPendingRecoveryCodes(recoveryCodes);
        setPendingLoginResult({
          res,
          submittedUsername: submittedUsername.trim(),
          identifier,
        });
        setRecoveryCodesCopied(false);
        return;
      }

      finishSuccessfulLogin(res, submittedUsername, identifier);
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
    setAuthenticatorChallenge(null);
    setAuthenticatorCode('');
    setPendingRecoveryCodes([]);
    setPendingLoginResult(null);
    setRecoveryCodesCopied(false);
    setLockoutNow(Date.now());
  };

  const resetAuthenticatorStep = () => {
    setAuthenticatorChallenge(null);
    setAuthenticatorCode('');
    setAuthenticatorQrCode('');
    setSecretCopied(false);
    setPendingRecoveryCodes([]);
    setPendingLoginResult(null);
    setRecoveryCodesCopied(false);
    setError('');
  };

  const copySetupKey = async () => {
    const secret = authenticatorChallenge?.authenticator?.secret;
    if (!secret || !navigator.clipboard) {
      return;
    }

    try {
      await navigator.clipboard.writeText(secret);
      setSecretCopied(true);
      window.setTimeout(() => setSecretCopied(false), 1800);
    } catch {
      setSecretCopied(false);
    }
  };

  const copyRecoveryCodes = async () => {
    if (pendingRecoveryCodes.length === 0 || !navigator.clipboard) {
      return;
    }

    try {
      await navigator.clipboard.writeText(pendingRecoveryCodes.join('\n'));
      setRecoveryCodesCopied(true);
      window.setTimeout(() => setRecoveryCodesCopied(false), 1800);
    } catch {
      setRecoveryCodesCopied(false);
    }
  };

  const confirmRecoveryCodesSaved = () => {
    if (!pendingLoginResult) {
      return;
    }

    finishSuccessfulLogin(
      pendingLoginResult.res,
      pendingLoginResult.submittedUsername,
      pendingLoginResult.identifier
    );
  };

  return (
    <div className="login-view min-h-[100dvh] overflow-y-auto bg-slate-50 px-4 py-6 text-slate-700 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100dvh-3rem)] max-w-5xl items-center">
        <div className="grid w-full overflow-hidden rounded-2xl border border-slate-200 bg-white lg:grid-cols-[22rem_minmax(0,1fr)]">
          <aside className="hidden border-r border-slate-200 bg-slate-50 p-7 lg:flex lg:flex-col">
            <div className="flex items-center gap-3">
              <BrandLogo className="h-12 w-12" />
              <div className="min-w-0">
                <div className="truncate text-xl font-semibold text-slate-950">SmartCanteen</div>
                <div className="mt-1 text-[11px] font-medium uppercase tracking-wider text-slate-500">
                  Operations Workspace
                </div>
              </div>
            </div>

            <div className="mt-10">
              <div className="inline-flex items-center gap-2 rounded-full border border-teal-100 bg-teal-50 px-3 py-1 text-xs font-medium text-primary">
                <ShieldCheckIcon className="h-4 w-4" />
                Protected access
              </div>
              <h1 className="mt-4 max-w-xs text-2xl font-semibold leading-8 text-slate-950">
                Secure access for daily canteen service.
              </h1>
              <p className="mt-3 text-sm leading-6 text-slate-500">
                Open only the workspace your role needs, with authenticator checks for account safety.
              </p>
            </div>

            <div className="mt-8 space-y-3">
              {workspaceDetails.map((item) => (
                <div key={item.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
                    <CheckCircleIcon className="h-4 w-4 shrink-0 text-primary" />
                    {item.label}
                  </div>
                  <div className="mt-1 pl-6 text-xs leading-5 text-slate-500">
                    {item.description}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-auto grid grid-cols-3 gap-2 pt-8">
              {accessDetails.map((item) => (
                <div key={item.label} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                    {item.label}
                  </div>
                  <div className="mt-1 truncate text-xs font-medium text-slate-700">
                    {item.value}
                  </div>
                </div>
              ))}
            </div>
          </aside>

          <section className="flex items-center justify-center px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
            <div className="w-full max-w-md">
              <div className="mb-8 flex items-center gap-3 lg:hidden">
                <BrandLogo className="h-11 w-11" />
                <div className="min-w-0">
                  <div className="truncate text-xl font-semibold text-slate-950">SmartCanteen</div>
                  <div className="mt-1 text-[11px] font-medium uppercase tracking-wider text-slate-500">
                    Operations Workspace
                  </div>
                </div>
              </div>

              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium uppercase tracking-wider text-slate-500">
                    <BuildingStorefrontIcon className="h-4 w-4" />
                    {portalLabel}
                  </div>
                  <h2 className="mt-5 text-2xl font-semibold leading-8 text-slate-950">
                    Welcome back
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    Sign in to continue to SmartCanteen.
                  </p>
                </div>
                <div className="hidden rounded-xl border border-slate-200 bg-slate-50 p-2 text-primary sm:block">
                  <ShieldCheckIcon className="h-5 w-5" />
                </div>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-2">
                <div className="flex items-center gap-2 rounded-xl border border-teal-100 bg-teal-50 px-3 py-2 text-xs font-medium text-primary">
                  <span className="h-2 w-2 rounded-full bg-primary" />
                  Secure
                </div>
                <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600">
                  <LockClosedIcon className="h-4 w-4 text-slate-400" />
                  Encrypted
                </div>
              </div>

              <div className="mt-5 space-y-3">
                {lockoutState.isLocked && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
                    <div className="font-semibold">Too many failed attempts</div>
                    <div className="mt-1">
                      This account is temporarily locked. Try again in {lockoutRemainingLabel}.
                    </div>
                  </div>
                )}
                {error && !isAuthenticatorStep && pendingRecoveryCodes.length === 0 && (
                  <DismissibleAlert resetKey={error} tone="red" title="Sign-in issue" className="rounded-xl">
                    {error}
                  </DismissibleAlert>
                )}
              </div>

              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                <label className="block">
                  <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    Username
                  </span>
                  <input
                    type="text"
                    required
                    placeholder="Enter your username"
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-base font-normal text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
                    value={username}
                    onChange={handleUsernameChange}
                    disabled={loading || isAuthenticatorStep}
                    autoComplete="username"
                  />
                </label>

                <label className="block">
                  <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    Password
                  </span>
                  <div className="relative mt-1.5">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      placeholder="Enter your password"
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 pr-12 text-base font-normal text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={loading || isAuthenticatorStep}
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute inset-y-0 right-2 inline-flex h-full w-10 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                    </button>
                  </div>
                </label>

                <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
                  <input
                    type="checkbox"
                    checked={rememberUsername}
                    onChange={(event) => setRememberUsername(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-2 focus:ring-primary/20"
                  />
                  Remember me for 30 days
                </label>

                <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                  <ShieldCheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <div className="text-xs leading-5 text-slate-500">
                    <span className="font-semibold text-slate-800">MFA required:</span> Use a 6-digit code from your authenticator app.
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={
                    loading ||
                    lockoutState.isLocked ||
                    !username ||
                    !password ||
                    (isAuthenticatorStep && !canSubmitAuthenticatorCode)
                  }
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-primary-dark active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {lockoutState.isLocked ? (
                    `Try again in ${lockoutRemainingLabel}`
                  ) : loading ? (
                    <span className="flex items-center gap-2">
                      <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                      Authenticating...
                    </span>
                  ) : isAuthenticatorSetup ? (
                    'Set Up & Sign In'
                  ) : isAuthenticatorStep ? (
                    'Verify Code'
                  ) : (
                    'Sign In'
                  )}
                </button>
              </form>

              <div className="mt-6 text-center text-xs font-medium text-slate-500">
                SmartCanteen - Secure Staff Access
              </div>
            </div>
          </section>
        </div>
      </div>

      {isAuthenticatorStep && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 px-4 py-5 backdrop-blur-sm">
          <div
            className="w-full max-w-[28rem] overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="authenticator-modal-title"
          >
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="inline-flex items-center gap-2 rounded-full border border-teal-100 bg-teal-50 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-primary">
                    <ShieldCheckIcon className="h-4 w-4" />
                    Authenticator app
                  </div>
                  <h3 id="authenticator-modal-title" className="mt-3 text-xl font-semibold leading-7 text-slate-950">
                    {isAuthenticatorSetup ? 'Set up verification' : 'Enter verification code'}
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    {isAuthenticatorSetup
                      ? 'Add SmartCanteen to your authenticator app, then enter the 6-digit code.'
                      : 'Open your authenticator app and enter the current 6-digit code.'}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-2 text-primary">
                  <LockClosedIcon className="h-5 w-5" />
                </div>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="max-h-[calc(100dvh-8rem)] overflow-y-auto px-5 py-5">
              {error && (
                <DismissibleAlert
                  resetKey={`${error}-${authenticatorCode}`}
                  tone="red"
                  title={isAuthenticatorSetup ? 'Authenticator setup issue' : 'Verification issue'}
                  className="mb-4 rounded-xl"
                >
                  {error}
                </DismissibleAlert>
              )}

              {isAuthenticatorSetup && (
                <div className="mb-4 grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
                  {authenticatorQrCode && (
                    <div className="mx-auto rounded-2xl bg-white p-2 sm:mx-0">
                      <img
                        src={authenticatorQrCode}
                        alt="Authenticator setup QR code"
                        className="h-36 w-36"
                      />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-xs leading-5 text-slate-500">
                      Scan the QR code or enter this setup key in Google Authenticator,
                      Microsoft Authenticator, Authy, or another TOTP app.
                    </div>
                    <div className="mt-2 break-all rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm font-semibold tracking-wider text-slate-800">
                      {authenticatorChallenge?.authenticator?.secret_formatted}
                    </div>
                    <button
                      type="button"
                      onClick={copySetupKey}
                      className="mt-2 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
                    >
                      {secretCopied ? 'Copied' : 'Copy key'}
                    </button>
                  </div>
                </div>
              )}

              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
                  6-digit code or recovery code
                </span>
                <input
                  ref={authenticatorCodeRef}
                  type="text"
                  inputMode={isAuthenticatorSetup ? 'numeric' : 'text'}
                  required
                  placeholder={isAuthenticatorSetup ? '000000' : '000000 or code'}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-4 text-center font-mono text-2xl font-semibold tracking-[0.24em] text-slate-900 outline-none transition placeholder:text-slate-300 focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
                  value={authenticatorCode}
                  onChange={(event) =>
                    setAuthenticatorCode(normalizeAuthenticatorCode(event.target.value, {
                      setup: isAuthenticatorSetup,
                    }))
                  }
                  disabled={loading}
                  autoComplete="one-time-code"
                />
                {!isAuthenticatorSetup && (
                  <span className="mt-2 block text-xs leading-5 text-slate-500">
                    Lost your authenticator app? Enter one saved recovery code here.
                  </span>
                )}
              </label>

              <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={resetAuthenticatorStep}
                  disabled={loading}
                  className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Use a different account
                </button>
                <button
                  type="submit"
                  disabled={loading || !canSubmitAuthenticatorCode}
                  className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-white transition hover:bg-primary-dark active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? (
                    <>
                      <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                      Verifying...
                    </>
                  ) : isAuthenticatorSetup ? (
                    'Set Up & Sign In'
                  ) : (
                    'Verify Code'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {pendingRecoveryCodes.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 px-4 py-5 backdrop-blur-sm">
          <div
            className="w-full max-w-[32rem] overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="recovery-codes-title"
          >
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-teal-100 bg-teal-50 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-primary">
                <ShieldCheckIcon className="h-4 w-4" />
                Backup access
              </div>
              <h3 id="recovery-codes-title" className="mt-3 text-xl font-semibold leading-7 text-slate-950">
                Save your recovery codes
              </h3>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                Each code works once if the authenticator app is deleted or unavailable.
              </p>
            </div>

            <div className="max-h-[calc(100dvh-8rem)] overflow-y-auto px-5 py-5">
              <div className="grid gap-2 sm:grid-cols-2">
                {pendingRecoveryCodes.map((code) => (
                  <div
                    key={code}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-center font-mono text-sm font-semibold tracking-wider text-slate-800"
                  >
                    {code}
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
                Store these in a password manager or another secure place. They will not be shown again.
              </div>

              <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={copyRecoveryCodes}
                  className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
                >
                  {recoveryCodesCopied ? 'Copied' : 'Copy codes'}
                </button>
                <button
                  type="button"
                  onClick={confirmRecoveryCodesSaved}
                  className="rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-white transition hover:bg-primary-dark active:scale-[0.99]"
                >
                  I saved these codes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
