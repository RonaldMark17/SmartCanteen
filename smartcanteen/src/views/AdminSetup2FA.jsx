import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { API } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import BrandLogo from '../components/BrandLogo';
import DismissibleAlert from '../components/DismissibleAlert';
import {
  ArrowDownTrayIcon,
  ArrowRightIcon,
  CheckIcon,
  ClipboardDocumentIcon,
  KeyIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';
import { downloadRecoveryCodesFile } from '../utils/downloadRecoveryCodes';

const MFA_CHALLENGE_STORAGE_KEY = 'sc_pending_authenticator_challenge';

export default function AdminSetup2FA({ initialChallenge = null, onComplete = null, onCancel = null }) {
  const navigate = useNavigate();
  const { login, user: currentUser, refreshUser } = useAuth();

  const [challenge, setChallenge] = useState(() => {
    if (initialChallenge) return initialChallenge;
    try {
      const raw = sessionStorage.getItem(MFA_CHALLENGE_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(!challenge?.authenticator?.otpauth_url);
  const [error, setError] = useState('');
  const [secretCopied, setSecretCopied] = useState(false);
  const [showManualKey, setShowManualKey] = useState(false);

  // Recovery codes modal after setup
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [recoveryCodesCopied, setRecoveryCodesCopied] = useState(false);
  const [verifiedSession, setVerifiedSession] = useState(null);

  const codeInputRef = useRef(null);

  // If no challenge is present, fetch setup credentials from backend
  useEffect(() => {
    if (challenge?.authenticator?.otpauth_url) {
      setInitializing(false);
      return;
    }

    let active = true;
    setInitializing(true);
    setError('');

    API.startMyAuthenticatorSetup()
      .then((res) => {
        if (!active) return;
        setChallenge(res);
        try {
          sessionStorage.setItem(MFA_CHALLENGE_STORAGE_KEY, JSON.stringify(res));
        } catch {
          /* ignore storage access error */
        }
      })
      .catch((err) => {
        if (!active) return;
        setError(err?.message || 'Failed to initialize 2FA setup. Please try signing in again.');
      })
      .finally(() => {
        if (active) setInitializing(false);
      });

    return () => {
      active = false;
    };
  }, [challenge]);

  // Generate QR Code image from otpauth URL
  useEffect(() => {
    const otpUrl = challenge?.authenticator?.otpauth_url;
    if (!otpUrl) {
      setQrCodeUrl('');
      return;
    }

    let active = true;
    QRCode.toDataURL(otpUrl, {
      margin: 1,
      width: 220,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then((url) => {
        if (active) setQrCodeUrl(url);
      })
      .catch(() => {
        if (active) setQrCodeUrl('');
      });

    return () => {
      active = false;
    };
  }, [challenge]);

  // Focus input when ready
  useEffect(() => {
    if (!initializing && qrCodeUrl) {
      codeInputRef.current?.focus();
    }
  }, [initializing, qrCodeUrl]);

  const handleCopySecret = async () => {
    const secret = challenge?.authenticator?.secret;
    if (!secret || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(secret);
      setSecretCopied(true);
      setTimeout(() => setSecretCopied(false), 2000);
    } catch {
      setSecretCopied(false);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    const cleanCode = code.replace(/\D/g, '').trim();
    if (cleanCode.length !== 6) {
      setError('Please enter a valid 6-digit verification code.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const mfaToken = challenge?.mfa_token;
      const isRemembered = Boolean(
        challenge?.remember_me !== undefined
          ? challenge.remember_me
          : localStorage.getItem('sc_remember_me') === 'true'
      );
      let res;

      if (mfaToken) {
        // Authenticating during login challenge
        res = await API.verifyAuthenticatorLogin(mfaToken, cleanCode, '', {
          rememberDevice: isRemembered,
          rememberMe: isRemembered,
          username: challenge?.user?.username || currentUser?.username || 'admin',
        });
      } else {
        // Authenticating via authenticated session
        res = await API.verifyAuthenticatorSetup({ code: cleanCode, rememberDevice: isRemembered, rememberMe: isRemembered });
      }

      const receivedCodes = Array.isArray(res?.recovery_codes) ? res.recovery_codes : [];
      const updatedUser = res?.user || {
        ...(currentUser || {}),
        role: 'admin',
        authenticator_mfa_enabled: true,
        two_factor_verified: true,
        '2fa_enabled': true,
      };

      try {
        sessionStorage.removeItem(MFA_CHALLENGE_STORAGE_KEY);
      } catch {
        /* ignore storage access error */
      }

      if (receivedCodes.length > 0) {
        setRecoveryCodes(receivedCodes);
        setVerifiedSession({ user: updatedUser, token: res?.access_token });
      } else {
        finishSetup(updatedUser, res?.access_token);
      }
    } catch (err) {
      setError(
        err?.message ||
          'Invalid verification code. Check that the code is current and your device clock is accurate.'
      );
    } finally {
      setLoading(false);
    }
  };

  const finishSetup = (user, token) => {
    const isRemembered = Boolean(
      challenge?.remember_me !== undefined
        ? challenge.remember_me
        : localStorage.getItem('sc_remember_me') === 'true'
    );
    if (user) {
      login(user, token, isRemembered);
    }
    refreshUser?.();
    if (typeof onComplete === 'function') {
      onComplete(user, token, isRemembered);
    }
    navigate('/admin/dashboard', { replace: true });
  };

  const handleCopyRecoveryCodes = async () => {
    if (!recoveryCodes.length || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      setRecoveryCodesCopied(true);
      setTimeout(() => setRecoveryCodesCopied(false), 2000);
    } catch {
      /* ignore clipboard copy error */
    }
  };

  const handleDownloadRecoveryCodes = () => {
    const username = verifiedSession?.user?.username || currentUser?.username || 'admin';
    downloadRecoveryCodesFile(recoveryCodes, username);
  };

  return (
    <>
      <div className="login-view relative flex min-h-full w-full flex-col justify-center items-center overflow-y-auto px-4 py-6 sm:px-6 lg:px-8 selection:bg-emerald-500/20 selection:text-emerald-800 dark:selection:bg-emerald-500/30 dark:selection:text-emerald-200">
        {/* Main card container */}
        <div className="relative z-10 w-full max-w-[460px] my-auto">
          <div className="relative overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 p-6 sm:p-8 shadow-xl shadow-slate-200/60 dark:shadow-2xl dark:shadow-black/60 backdrop-blur-md transition-all">
            {/* Subtle top card accent line */}
            <div className="absolute inset-x-0 top-0 h-[3px] bg-emerald-600 dark:bg-emerald-500" />

            {/* Brand Header */}
            <div className="flex flex-col items-center text-center">
              <div className="mb-3.5 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800 p-2 shadow-xs">
                <BrandLogo className="h-full w-full object-contain" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                MEALS
              </h1>
              <div className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                <ShieldCheckIcon className="h-3.5 w-3.5" />
                Admin 2FA Setup
              </div>
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 max-w-sm leading-relaxed">
                Two-Factor Authentication is required for administrator accounts before accessing the Admin Dashboard.
              </p>
            </div>

            {/* Error alert */}
            {error && (
              <div className="mt-4">
                <DismissibleAlert
                  tone="red"
                  title="Verification Issue"
                  className="rounded-xl"
                  onDismiss={() => setError('')}
                >
                  {error}
                </DismissibleAlert>
              </div>
            )}

            {initializing ? (
              <div className="flex flex-col items-center justify-center py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                <div className="h-7 w-7 animate-spin rounded-full border-2 border-emerald-500/20 border-t-emerald-600 dark:border-t-emerald-400" />
                <p className="mt-3 font-medium">Generating your 2FA authentication key...</p>
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                {/* Step 1: Scan QR */}
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-[11px] font-black">
                        1
                      </span>
                      Scan with Authenticator App
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowManualKey((prev) => !prev)}
                      className="text-[11px] font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 transition"
                    >
                      {showManualKey ? 'Hide key' : 'Show manual key'}
                    </button>
                  </div>

                  <div className="mt-3 flex flex-col sm:flex-row items-center gap-3.5">
                    {qrCodeUrl ? (
                      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white p-2 shadow-xs shrink-0">
                        <img
                          src={qrCodeUrl}
                          alt="2FA QR Code"
                          className="h-28 w-28 object-contain"
                        />
                      </div>
                    ) : (
                      <div className="flex h-28 w-28 items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 text-[11px] text-slate-400 shrink-0">
                        Loading QR...
                      </div>
                    )}

                    <div className="min-w-0 flex-1 space-y-2 text-xs text-slate-500 dark:text-slate-400">
                      <p className="leading-relaxed">
                        Open <strong className="text-slate-700 dark:text-slate-200">Google Authenticator</strong> or your preferred TOTP app and scan this code.
                      </p>

                      {showManualKey && challenge?.authenticator?.secret && (
                        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2 text-xs">
                          <span className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                            Setup Key (Base32)
                          </span>
                          <div className="mt-1 flex items-center justify-between gap-1">
                            <code className="font-mono text-[11px] font-bold text-emerald-600 dark:text-emerald-400 break-all select-all">
                              {challenge.authenticator.secret_formatted || challenge.authenticator.secret}
                            </code>
                            <button
                              type="button"
                              onClick={handleCopySecret}
                              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                            >
                              {secretCopied ? (
                                <>
                                  <CheckIcon className="h-3 w-3 text-emerald-500" />
                                  Copied
                                </>
                              ) : (
                                <>
                                  <ClipboardDocumentIcon className="h-3 w-3" />
                                  Copy
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Step 2: Verification Input */}
                <form onSubmit={handleVerify} className="space-y-3.5">
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5 text-xs font-bold text-slate-800 dark:text-slate-200">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-[11px] font-black">
                        2
                      </span>
                      <label htmlFor="admin-setup-2fa-code" className="cursor-pointer">
                        Enter 6-Digit Code
                      </label>
                    </div>

                    <input
                      ref={codeInputRef}
                      id="admin-setup-2fa-code"
                      name="two_factor_code"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      required
                      placeholder="000000"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-950/60 px-4 py-2.5 text-center font-mono text-2xl font-bold tracking-[0.25em] text-emerald-600 dark:text-emerald-400 placeholder-slate-400 dark:placeholder-slate-600 outline-none transition duration-150 focus:border-emerald-600 focus:bg-white dark:focus:bg-slate-950 focus:ring-2 focus:ring-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-60 shadow-xs"
                      disabled={loading}
                      autoComplete="one-time-code"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading || code.replace(/\D/g, '').length !== 6}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loading ? (
                      <>
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        Verifying Code...
                      </>
                    ) : (
                      <>
                        <span>Verify &amp; Enable 2FA</span>
                        <ArrowRightIcon className="h-4 w-4 stroke-[2.5]" />
                      </>
                    )}
                  </button>

                  {/* Cancel */}
                  {typeof onCancel === 'function' && (
                    <div className="text-center pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          try {
                            sessionStorage.removeItem(MFA_CHALLENGE_STORAGE_KEY);
                          } catch {
                            /* ignore storage access error */
                          }
                          onCancel();
                        }}
                        className="text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition"
                      >
                        Cancel and return to sign in
                      </button>
                    </div>
                  )}
                </form>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Recovery Codes Modal (layered on top at z-50) ── */}
      {recoveryCodes.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 dark:bg-slate-950/80 px-4 py-5 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xl">
            <div className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400">
                  <KeyIcon className="h-5 w-5 stroke-[2]" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">Save Emergency Recovery Codes</h3>
                  <p className="mt-0.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                    2FA is now enabled. Save these one-time codes in a safe place.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                If you ever lose access to your authenticator app, each of these backup codes can be used once to regain access to your administrator account.
              </p>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3.5">
                <div className="grid grid-cols-2 gap-2 font-mono text-xs font-bold text-emerald-700 dark:text-emerald-400">
                  {recoveryCodes.map((rc, idx) => (
                    <div key={idx} className="rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-center tracking-wider shadow-xs">
                      {rc}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleCopyRecoveryCodes}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
                >
                  {recoveryCodesCopied ? (
                    <>
                      <CheckIcon className="h-4 w-4 text-emerald-500" />
                      Copied All Codes
                    </>
                  ) : (
                    <>
                      <ClipboardDocumentIcon className="h-4 w-4" />
                      Copy All Codes
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadRecoveryCodes}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
                >
                  <ArrowDownTrayIcon className="h-4 w-4" />
                  Download as TXT
                </button>
              </div>

              <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => finishSetup(verifiedSession?.user, verifiedSession?.token)}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition active:scale-[0.99]"
                >
                  <span>I've Saved My Codes — Go to Dashboard</span>
                  <ArrowRightIcon className="h-4 w-4 stroke-[2.5]" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
