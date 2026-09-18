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

export default function AdminSetup2FA({ initialChallenge = null, onComplete = null }) {
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
        } catch {}
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
      let res;

      if (mfaToken) {
        // Authenticating during login challenge
        res = await API.verifyAuthenticatorLogin(mfaToken, cleanCode, '', {
          rememberDevice: true,
          username: challenge?.user?.username || currentUser?.username || 'admin',
        });
      } else {
        // Authenticating via authenticated session
        res = await API.verifyAuthenticatorSetup({ code: cleanCode });
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
      } catch {}

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
    if (user) {
      login(user, token);
    }
    refreshUser?.();
    if (typeof onComplete === 'function') {
      onComplete(user, token);
    }
    navigate('/admin/dashboard', { replace: true });
  };

  const handleCopyRecoveryCodes = async () => {
    if (!recoveryCodes.length || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      setRecoveryCodesCopied(true);
      setTimeout(() => setRecoveryCodesCopied(false), 2000);
    } catch {}
  };

  const handleDownloadRecoveryCodes = () => {
    const username = verifiedSession?.user?.username || currentUser?.username || 'admin';
    downloadRecoveryCodesFile(recoveryCodes, username);
  };

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center bg-slate-950 px-4 py-10 text-slate-100 selection:bg-emerald-500 selection:text-white">
      {/* Background ambient lighting */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-[32rem] w-[32rem] rounded-full bg-emerald-500/15 blur-[120px]" />
        <div className="absolute -bottom-40 left-1/2 -translate-x-1/2 h-[32rem] w-[32rem] rounded-full bg-teal-500/10 blur-[140px]" />
      </div>

      <div className="relative z-10 w-full max-w-xl">
        {/* Header Branding */}
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="relative mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-500/30 bg-slate-900/90 p-2.5 shadow-xl backdrop-blur-md">
            <BrandLogo className="h-full w-full drop-shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-bold tracking-wide uppercase text-emerald-400">
            <ShieldCheckIcon className="h-4 w-4 stroke-[2.5]" />
            Administrator Security Policy
          </div>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-white sm:text-3xl">
            Set Up Two-Factor Authentication
          </h1>
          <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-400 sm:text-sm">
            Two-Factor Authentication (2FA) is mandatory for all administrator accounts before accessing the Admin Dashboard.
          </p>
        </div>

        {/* Main Setup Card */}
        <div className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
          {error && (
            <DismissibleAlert
              tone="red"
              title="Verification Issue"
              className="mb-6 rounded-xl"
              onDismiss={() => setError('')}
            >
              {error}
            </DismissibleAlert>
          )}

          {initializing ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-sm text-slate-400">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500/20 border-t-emerald-400" />
              <p className="mt-4 font-semibold">Generating your 2FA authentication key...</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Step 1: Scan QR */}
              <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-emerald-400">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-[11px]">
                    1
                  </span>
                  Scan with Authenticator App
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Open Google Authenticator, Microsoft Authenticator, or Authy and scan this QR code:
                </p>

                <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
                  {qrCodeUrl ? (
                    <div className="rounded-2xl border border-white/10 bg-white p-3 shadow-md shrink-0">
                      <img
                        src={qrCodeUrl}
                        alt="2FA QR Code"
                        className="h-40 w-40 object-contain"
                      />
                    </div>
                  ) : (
                    <div className="flex h-40 w-40 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900 text-xs text-slate-500 shrink-0">
                      Loading QR...
                    </div>
                  )}

                  <div className="min-w-0 flex-1 space-y-2 text-xs text-slate-400">
                    <p className="leading-relaxed">
                      Can't scan? Tap below to view and copy the manual setup key:
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowManualKey((prev) => !prev)}
                      className="text-xs font-bold text-emerald-400 hover:underline"
                    >
                      {showManualKey ? 'Hide manual key' : 'Show manual secret key'}
                    </button>

                    {showManualKey && challenge?.authenticator?.secret && (
                      <div className="mt-2 rounded-xl border border-slate-800 bg-slate-900 p-3">
                        <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          Setup Key (Base32)
                        </span>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <code className="font-mono text-xs font-black text-emerald-300 break-all select-all">
                            {challenge.authenticator.secret_formatted || challenge.authenticator.secret}
                          </code>
                          <button
                            type="button"
                            onClick={handleCopySecret}
                            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-bold text-slate-200 transition hover:bg-slate-700"
                          >
                            {secretCopied ? (
                              <>
                                <CheckIcon className="h-3.5 w-3.5 text-emerald-400" />
                                Copied
                              </>
                            ) : (
                              <>
                                <ClipboardDocumentIcon className="h-3.5 w-3.5" />
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
              <form onSubmit={handleVerify} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5 space-y-4">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-emerald-400">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-[11px]">
                    2
                  </span>
                  Enter 6-Digit Code
                </div>
                <p className="text-xs text-slate-400">
                  Enter the current 6-digit verification code displayed in your authenticator app to complete setup:
                </p>

                <div className="space-y-2">
                  <input
                    ref={codeInputRef}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    required
                    placeholder="000000"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-center font-mono text-3xl font-black tracking-[0.3em] text-emerald-400 placeholder-slate-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                    disabled={loading}
                    autoComplete="one-time-code"
                  />
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={loading || code.replace(/\D/g, '').length !== 6}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-900/30 transition hover:bg-emerald-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loading ? (
                      <>
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        Verifying Code...
                      </>
                    ) : (
                      <>
                        <span>Verify & Enable 2FA</span>
                        <ArrowRightIcon className="h-4 w-4 stroke-[2.5]" />
                      </>
                    )}
                  </button>
                </div>
              </form>

              {/* Cancel / Sign In with Another Account */}
              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => {
                    try {
                      sessionStorage.removeItem(MFA_CHALLENGE_STORAGE_KEY);
                    } catch {}
                    navigate('/login', { replace: true });
                  }}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-300 transition"
                >
                  Cancel and return to sign in
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recovery Codes Modal on Success */}
      {recoveryCodes.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 py-6 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-emerald-500/30 bg-slate-900 text-slate-100 shadow-2xl">
            <div className="border-b border-slate-800 bg-emerald-950/40 px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
                  <KeyIcon className="h-6 w-6 stroke-[2]" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-white">Save Your Emergency Recovery Codes</h3>
                  <p className="mt-0.5 text-xs text-emerald-300">
                    2FA is now enabled. Save these one-time codes in a safe place.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-xs leading-relaxed text-slate-300">
                If you ever lose access to your phone or authenticator app, each of these backup codes can be used once to regain access to your administrator account.
              </p>

              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <div className="grid grid-cols-2 gap-2 font-mono text-xs font-bold text-emerald-400">
                  {recoveryCodes.map((rc, idx) => (
                    <div key={idx} className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-center tracking-wider">
                      {rc}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleCopyRecoveryCodes}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-200 transition hover:bg-slate-700"
                >
                  {recoveryCodesCopied ? (
                    <>
                      <CheckIcon className="h-4 w-4 text-emerald-400" />
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
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-200 transition hover:bg-slate-700"
                >
                  <ArrowDownTrayIcon className="h-4 w-4" />
                  Download as TXT
                </button>
              </div>

              <div className="pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => finishSetup(verifiedSession?.user, verifiedSession?.token)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-900/30 transition hover:bg-emerald-500 active:scale-[0.99]"
                >
                  <span>I've Saved My Codes — Go to Dashboard</span>
                  <ArrowRightIcon className="h-4 w-4 stroke-[2.5]" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
