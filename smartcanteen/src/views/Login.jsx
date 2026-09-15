import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { API } from '../services/api';
import { safeLocalStorageSetItem, safeLocalStorageSetJson } from '../services/storage';
import BrandLogo from '../components/BrandLogo';
import DismissibleAlert from '../components/DismissibleAlert';
import {
  ArrowRightIcon,
  EyeIcon,
  EyeSlashIcon,
  KeyIcon,
  LockClosedIcon,
  ShieldCheckIcon,
  UserIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

const LOGIN_LOCKOUT_STORAGE_KEY = 'sc_login_lockouts';
const REMEMBERED_USERNAME_STORAGE_KEY = 'sc_remembered_username';
const MFA_CHALLENGE_STORAGE_KEY = 'sc_pending_authenticator_challenge';
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_INITIAL_MS = 2 * 60 * 1000;    // 2 minutes
const LOGIN_LOCKOUT_REPEATED_MS = 15 * 60 * 1000;  // 15 minutes
const MFA_CHALLENGE_MAX_AGE_MS = 5 * 60 * 1000;
const RECOVERY_CODE_LENGTH = 12;
const PASSWORD_RESET_REQUEST_SENT_MESSAGE = 'Your password reset request has been sent. Please wait for admin approval.';
const PASSWORD_RESET_STATUS_MESSAGES = {
  pending: 'Your password reset request is still pending. Please wait for admin approval.',
  approved: 'Your password reset request has been approved. You may now change your password.',
  declined: 'Your password reset request was declined. You may submit an appeal if you believe this was a mistake.',
  appealed: 'Your appeal has been submitted. Please wait for admin review.',
  appeal_approved: 'Your password reset appeal has been approved. You may now change your password.',
  appeal_declined: 'Your appeal was declined. Please contact the admin for assistance.',
  expired: 'Your password reset approval has expired. Please send a new request.',
  used: 'This password reset request has already been used. Please send a new request if you need another password change.',
  none: 'No password reset request was found for this account.',
};
const PASSWORD_RESET_CHANGE_STATUSES = new Set(['approved', 'appeal_approved']);
const AUTHENTICATOR_RECOVERY_REQUEST_SENT_MESSAGE =
  'Your authenticator recovery request has been sent. Please wait for admin approval.';
const AUTHENTICATOR_RECOVERY_STATUS_MESSAGES = {
  pending: 'Your authenticator recovery request is still pending. Please wait for admin approval.',
  approved: 'Your authenticator recovery request has been approved. You may now set up a new authenticator.',
  declined: 'Your authenticator recovery request was declined. You may submit an appeal if you believe this was a mistake.',
  appealed: 'Your appeal has been submitted. Please wait for admin review.',
  appeal_approved: 'Your authenticator recovery request has been approved. You may now set up a new authenticator.',
  appeal_declined: 'Your appeal was declined. Please contact the admin for assistance.',
  expired: 'Your authenticator recovery approval has expired. Please send a new request.',
  used: 'This authenticator recovery request has already been used. Please send a new request if you need another recovery.',
  none: 'No authenticator recovery request was found for this account.',
};
const AUTHENTICATOR_RECOVERY_SETUP_STATUSES = new Set(['approved', 'appeal_approved']);

function normalizePasswordResetStatus(status) {
  const value = String(status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (value === 'denied') {
    return 'declined';
  }
  if (value === 'completed') {
    return 'used';
  }
  if (value === 'appealapproved') {
    return 'appeal_approved';
  }
  if (value === 'appealdeclined' || value === 'appealdenied' || value === 'appeal_denied') {
    return 'appeal_declined';
  }
  return value;
}

function getPasswordResetMessage(statusResult) {
  const status = normalizePasswordResetStatus(statusResult?.status);
  return statusResult?.message || PASSWORD_RESET_STATUS_MESSAGES[status] || PASSWORD_RESET_STATUS_MESSAGES.none;
}

function getPasswordResetTone(statusResult) {
  const status = normalizePasswordResetStatus(statusResult?.status);
  if (PASSWORD_RESET_CHANGE_STATUSES.has(status)) {
    return 'emerald';
  }
  if (status === 'pending' || status === 'appealed') {
    return 'amber';
  }
  if (status === 'declined' || status === 'appeal_declined' || status === 'expired' || status === 'used') {
    return 'red';
  }
  return 'slate';
}

function getAuthenticatorRecoveryMessage(statusResult) {
  const status = normalizePasswordResetStatus(statusResult?.status);
  return (
    statusResult?.message ||
    AUTHENTICATOR_RECOVERY_STATUS_MESSAGES[status] ||
    AUTHENTICATOR_RECOVERY_STATUS_MESSAGES.none
  );
}

function getAuthenticatorRecoveryTone(statusResult) {
  const status = normalizePasswordResetStatus(statusResult?.status);
  if (AUTHENTICATOR_RECOVERY_SETUP_STATUSES.has(status)) {
    return 'emerald';
  }
  if (status === 'pending' || status === 'appealed') {
    return 'amber';
  }
  if (status === 'declined' || status === 'appeal_declined' || status === 'expired' || status === 'used') {
    return 'red';
  }
  return 'slate';
}

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
      const lockoutCount = Number(record?.lockoutCount || 0);
      const lockedUntil = Number(record?.lockedUntil || 0);

      if (lockedUntil > 0 && lockedUntil <= now) {
        activeLockouts[identifier] = { attempts: 0, lockoutCount, lockedUntil: 0 };
        changed = true;
        return;
      }

      if (attempts > 0 || lockedUntil > now || lockoutCount > 0) {
        activeLockouts[identifier] = { attempts, lockoutCount, lockedUntil };
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
      lockoutCount: 0,
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
  const lockoutCount = Number(record.lockoutCount || 0);
  const attempts = isLocked ? MAX_LOGIN_ATTEMPTS : Number(record.attempts || 0);

  return {
    attempts,
    lockoutCount,
    isLocked,
    lockedUntil,
    remainingAttempts: Math.max(0, MAX_LOGIN_ATTEMPTS - attempts),
    remainingMs,
  };
}

function recordFailedLogin(identifier, now = Date.now(), serverLockDetails = null) {
  if (!identifier) {
    return getLoginLockoutState(identifier, now);
  }

  const lockouts = readLoginLockouts(now);
  const existingRecord = lockouts[identifier] || {};
  const currentAttempts = Number(existingRecord.attempts || 0);
  let lockoutCount = Number(existingRecord.lockoutCount || 0);

  if (serverLockDetails?.locked) {
    const serverLockedUntil = Number(serverLockDetails.lockedUntil || 0);
    const serverRetryMs = Number(serverLockDetails.retryAfterSeconds || 0) * 1000;
    const duration = serverLockedUntil > now ? serverLockedUntil : now + (serverRetryMs || LOGIN_LOCKOUT_INITIAL_MS);
    lockoutCount = Number(serverLockDetails.lockoutCount ?? (lockoutCount + 1));
    lockouts[identifier] = { attempts: 0, lockoutCount, lockedUntil: duration };
  } else {
    if (serverLockDetails?.lockoutCount !== undefined && Number.isFinite(Number(serverLockDetails.lockoutCount))) {
      lockoutCount = Number(serverLockDetails.lockoutCount);
    }

    const hasServerRemaining = Number.isFinite(serverLockDetails?.remainingAttempts);
    const attempts = hasServerRemaining
      ? Math.max(0, Math.min(MAX_LOGIN_ATTEMPTS, MAX_LOGIN_ATTEMPTS - Number(serverLockDetails.remainingAttempts)))
      : Math.min(MAX_LOGIN_ATTEMPTS, currentAttempts + 1);

    if (attempts >= MAX_LOGIN_ATTEMPTS) {
      const lockDuration = lockoutCount === 0 ? LOGIN_LOCKOUT_INITIAL_MS : LOGIN_LOCKOUT_REPEATED_MS;
      lockoutCount += 1;
      lockouts[identifier] = {
        attempts: 0,
        lockoutCount,
        lockedUntil: now + lockDuration,
      };
    } else {
      lockouts[identifier] = {
        attempts,
        lockoutCount,
        lockedUntil: 0,
      };
    }
  }

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

const DEFAULT_VERIFICATION_ERROR_MESSAGE = 'Invalid verification code. Please try again.';

function extractReadableErrorMessage(value) {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    return value === '[object Object]' ? '' : value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => extractReadableErrorMessage(item))
      .filter(Boolean)
      .join('; ');
  }

  if (typeof value === 'object') {
    return (
      extractReadableErrorMessage(value.message) ||
      extractReadableErrorMessage(value.detail) ||
      extractReadableErrorMessage(value.msg)
    );
  }

  return '';
}

function getErrorResponseDetail(error) {
  const responseDetail = error?.response?.data?.detail;
  if (responseDetail !== undefined) {
    return responseDetail;
  }
  return error?.apiDetail || error?.detail || null;
}

function getReadableErrorMessage(error, fallbackMessage) {
  const responseData = error?.response?.data;
  return (
    extractReadableErrorMessage(responseData?.detail) ||
    extractReadableErrorMessage(responseData?.message) ||
    extractReadableErrorMessage(error?.apiDetail) ||
    extractReadableErrorMessage(error?.detail) ||
    extractReadableErrorMessage(error?.message) ||
    fallbackMessage
  );
}

function getReadableErrorTitle(error, fallbackTitle) {
  const detail = getErrorResponseDetail(error);
  const title =
    (detail && typeof detail === 'object' && !Array.isArray(detail) ? detail.title : '') ||
    error?.alertTitle ||
    error?.title;

  return typeof title === 'string' && title.trim() ? title : fallbackTitle;
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

function readStoredAuthenticatorChallenge(now = Date.now()) {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(MFA_CHALLENGE_STORAGE_KEY) || 'null');
    const savedAt = Number(parsed?.savedAt || 0);
    const challenge = parsed?.challenge;

    if (
      !challenge ||
      !challenge.mfa_required ||
      !challenge.mfa_token ||
      !challenge.mfa_type ||
      !savedAt ||
      now - savedAt > MFA_CHALLENGE_MAX_AGE_MS
    ) {
      sessionStorage.removeItem(MFA_CHALLENGE_STORAGE_KEY);
      return null;
    }

    return challenge;
  } catch {
    return null;
  }
}

function saveStoredAuthenticatorChallenge(challenge) {
  try {
    if (!challenge?.mfa_required || !challenge?.mfa_token) {
      sessionStorage.removeItem(MFA_CHALLENGE_STORAGE_KEY);
      return;
    }

    sessionStorage.setItem(
      MFA_CHALLENGE_STORAGE_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        challenge,
      })
    );
  } catch {
    // The MFA token still lives in React state if session storage is unavailable.
  }
}

function clearStoredAuthenticatorChallenge() {
  try {
    sessionStorage.removeItem(MFA_CHALLENGE_STORAGE_KEY);
  } catch {
    // Session storage is optional for the MFA flow.
  }
}

function persistAuthenticatedSession(accessToken, user) {
  const quotaMessage =
    'This device is out of browser storage. MEALS cleared temporary cache, but there is still not enough space to save your session. Clear site data for this app and try again.';

  if (accessToken) {
    safeLocalStorageSetItem('sc_token', accessToken, { quotaMessage });
  }

  if (user) {
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
}

export default function Login({ onLogin }) {
  const [username, setUsername] = useState(getRememberedUsername);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberUsername, setRememberUsername] = useState(() => Boolean(getRememberedUsername()));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [authenticatorErrorTitle, setAuthenticatorErrorTitle] = useState('Verification issue');
  const [authenticatorChallenge, setAuthenticatorChallenge] = useState(readStoredAuthenticatorChallenge);
  const [authenticatorCode, setAuthenticatorCode] = useState('');
  const [authenticatorQrCode, setAuthenticatorQrCode] = useState('');
  const [secretCopied, setSecretCopied] = useState(false);
  const [authenticatorLockedUntil, setAuthenticatorLockedUntil] = useState(0);
  const [lockoutNow, setLockoutNow] = useState(() => Date.now());
  const [pendingRecoveryCodes, setPendingRecoveryCodes] = useState([]);
  const [pendingLoginResult, setPendingLoginResult] = useState(null);
  const [recoveryCodesCopied, setRecoveryCodesCopied] = useState(false);
  const [passwordResetOpen, setPasswordResetOpen] = useState(false);
  const [passwordResetMode, setPasswordResetMode] = useState('request');
  const [passwordResetIdentifier, setPasswordResetIdentifier] = useState('');
  const [passwordResetAppealReason, setPasswordResetAppealReason] = useState('');
  const [passwordResetNewPassword, setPasswordResetNewPassword] = useState('');
  const [passwordResetConfirmPassword, setPasswordResetConfirmPassword] = useState('');
  const [passwordResetLoading, setPasswordResetLoading] = useState(false);
  const [passwordResetError, setPasswordResetError] = useState('');
  const [passwordResetSuccess, setPasswordResetSuccess] = useState('');
  const [passwordResetStatus, setPasswordResetStatus] = useState(null);
  const [passwordResetCanChange, setPasswordResetCanChange] = useState(false);
  const [authRecoveryOpen, setAuthRecoveryOpen] = useState(false);
  const [authRecoveryMode, setAuthRecoveryMode] = useState('request');
  const [authRecoveryIdentifier, setAuthRecoveryIdentifier] = useState('');
  const [authRecoveryReason, setAuthRecoveryReason] = useState('');
  const [authRecoveryAppealReason, setAuthRecoveryAppealReason] = useState('');
  const [authRecoveryLoading, setAuthRecoveryLoading] = useState(false);
  const [authRecoveryError, setAuthRecoveryError] = useState('');
  const [authRecoverySuccess, setAuthRecoverySuccess] = useState('');
  const [authRecoveryStatus, setAuthRecoveryStatus] = useState(null);
  const [authRecoveryCanSetup, setAuthRecoveryCanSetup] = useState(false);
  const authenticatorCodeRef = useRef(null);

  const loginIdentifier = normalizeLoginIdentifier(username);
  const lockoutState = getLoginLockoutState(loginIdentifier, lockoutNow);
  const lockoutRemainingLabel = formatLockoutDuration(lockoutState.remainingMs);
  const isAuthenticatorStep = Boolean(authenticatorChallenge);
  const isAuthenticatorSetup = authenticatorChallenge?.mfa_type === 'authenticator_setup';
  const authenticatorLockRemainingMs = Math.max(0, Number(authenticatorLockedUntil || 0) - lockoutNow);
  const authenticatorLockRemainingLabel = formatLockoutDuration(authenticatorLockRemainingMs);
  const isAuthenticatorVerificationLocked = isAuthenticatorStep && authenticatorLockRemainingMs > 0;
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
    if (authenticatorChallenge?.mfa_required && authenticatorChallenge?.mfa_token) {
      saveStoredAuthenticatorChallenge(authenticatorChallenge);
    } else {
      clearStoredAuthenticatorChallenge();
    }
  }, [authenticatorChallenge]);

  useEffect(() => {
    if (!authenticatorLockedUntil || authenticatorLockedUntil > lockoutNow) {
      return;
    }

    setAuthenticatorLockedUntil(0);
    if (authenticatorErrorTitle === 'Verification locked') {
      setError('');
      setAuthenticatorErrorTitle('Verification issue');
    }
  }, [authenticatorErrorTitle, authenticatorLockedUntil, lockoutNow]);

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

    const challengeUsername = authenticatorChallenge?.user?.username;
    if (challengeUsername && username !== challengeUsername) {
      setUsername(challengeUsername);
    }

    const focusTimer = window.setTimeout(() => {
      authenticatorCodeRef.current?.focus();
    }, 80);

    return () => window.clearTimeout(focusTimer);
  }, [authenticatorChallenge, isAuthenticatorStep, username]);

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
    setAuthenticatorErrorTitle('Verification issue');
    setAuthenticatorLockedUntil(0);
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

    if (isAuthenticatorStep && isAuthenticatorVerificationLocked) {
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
        setAuthenticatorErrorTitle('Verification issue');
        setAuthenticatorLockedUntil(0);
        setSecretCopied(false);
        setLoading(false);
        return;
      }

      const recoveryCodes = Array.isArray(res?.recovery_codes) ? res.recovery_codes : [];
      if (recoveryCodes.length > 0) {
        setAuthenticatorChallenge(null);
        setAuthenticatorCode('');
        setAuthenticatorErrorTitle('Verification issue');
        setAuthenticatorLockedUntil(0);
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

      const message = getReadableErrorMessage(
        err,
        isAuthenticatorStep ? DEFAULT_VERIFICATION_ERROR_MESSAGE : 'Invalid username or password'
      );

      const detail = getErrorResponseDetail(err);
      const detailObject = detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : {};
      const retryAfterSeconds = Number(err.retryAfterSeconds ?? detailObject.retry_after_seconds ?? 0);
      const parsedLockedUntil = Date.parse(err.lockedUntil || detailObject.locked_until || '');
      const serverLockedUntil = Number.isFinite(parsedLockedUntil)
        ? parsedLockedUntil
        : retryAfterSeconds > 0
          ? Date.now() + retryAfterSeconds * 1000
          : 0;
      const isLockedError = Boolean(err.locked || detailObject.locked || err.status === 429 || serverLockedUntil > 0);

      if (isAuthenticatorStep) {
        setAuthenticatorErrorTitle(
          getReadableErrorTitle(err, isLockedError ? 'Verification locked' : 'Verification issue')
        );
        if (isLockedError) {
          setAuthenticatorLockedUntil(serverLockedUntil || Date.now() + LOGIN_LOCKOUT_INITIAL_MS);
          setLockoutNow(Date.now());
        } else {
          setAuthenticatorLockedUntil(0);
        }
        setError(message);
      } else if (isLockedError || isCredentialFailure(message) || err.status === 401 || err.status === 429) {
        const serverRemaining = Number(err.remainingAttempts ?? detailObject.remaining_attempts);
        const nextLockoutState = recordFailedLogin(
          identifier,
          Date.now(),
          isLockedError
            ? {
                locked: true,
                lockedUntil: serverLockedUntil,
                retryAfterSeconds,
                lockoutCount: detailObject.lockout_count,
              }
            : {
                locked: false,
                remainingAttempts: Number.isFinite(serverRemaining) ? serverRemaining : undefined,
                lockoutCount: detailObject.lockout_count,
              }
        );
        setLockoutNow(Date.now());

        if (nextLockoutState.isLocked) {
          setError('');
        } else {
          // If the error message already has remaining attempts or lockout info (e.g. from backend),
          // avoid appending duplicate attempt/lock text and double periods.
          const hasRemainingDetails =
            /(?:attempt|attempts)\s+remaining/i.test(message) ||
            /remaining\s+before/i.test(message);

          if (hasRemainingDetails) {
            setError(message);
          } else {
            const trimmedMessage = message.trim().replace(/\.+$/, '');
            const attemptLabel = nextLockoutState.remainingAttempts === 1 ? 'attempt' : 'attempts';
            const nextLockDurationStr = nextLockoutState.lockoutCount > 0 ? '15-minute' : '2-minute';
            setError(
              `${trimmedMessage}. ${nextLockoutState.remainingAttempts} ${attemptLabel} remaining before a ${nextLockDurationStr} lock.`
            );
          }
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
    setAuthenticatorErrorTitle('Verification issue');
    setAuthenticatorChallenge(null);
    setAuthenticatorCode('');
    setAuthenticatorLockedUntil(0);
    setPendingRecoveryCodes([]);
    setPendingLoginResult(null);
    setRecoveryCodesCopied(false);
    setLockoutNow(Date.now());
  };

  const resetAuthenticatorStep = () => {
    setAuthenticatorChallenge(null);
    setAuthenticatorCode('');
    setAuthenticatorQrCode('');
    setAuthenticatorErrorTitle('Verification issue');
    setAuthenticatorLockedUntil(0);
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

  const openPasswordReset = (mode = 'request') => {
    setPasswordResetMode(mode === 'change' && !passwordResetCanChange ? 'status' : mode);
    setPasswordResetIdentifier(username.trim());
    setPasswordResetAppealReason('');
    setPasswordResetNewPassword('');
    setPasswordResetConfirmPassword('');
    setPasswordResetError('');
    setPasswordResetSuccess('');
    setPasswordResetStatus(null);
    setPasswordResetCanChange(false);
    setPasswordResetOpen(true);
  };

  const closePasswordReset = () => {
    if (passwordResetLoading) {
      return;
    }

    setPasswordResetOpen(false);
    setPasswordResetError('');
    setPasswordResetSuccess('');
    setPasswordResetAppealReason('');
    setPasswordResetNewPassword('');
    setPasswordResetConfirmPassword('');
    setPasswordResetStatus(null);
    setPasswordResetCanChange(false);
  };

  const applyPasswordResetStatus = (statusResult) => {
    const status = normalizePasswordResetStatus(statusResult?.status);
    const normalizedResult = { ...(statusResult || {}), status };

    setPasswordResetStatus(normalizedResult);
    setPasswordResetSuccess(getPasswordResetMessage(normalizedResult));
    setPasswordResetError('');

    if (PASSWORD_RESET_CHANGE_STATUSES.has(status)) {
      setPasswordResetCanChange(true);
      setPasswordResetMode('change');
      return;
    }

    setPasswordResetCanChange(false);
    setPasswordResetNewPassword('');
    setPasswordResetConfirmPassword('');
  };

  const updatePasswordResetIdentifier = (value) => {
    setPasswordResetIdentifier(value);
    setPasswordResetCanChange(false);
    setPasswordResetStatus(null);
    setPasswordResetError('');
    setPasswordResetSuccess('');
    setPasswordResetAppealReason('');
    setPasswordResetNewPassword('');
    setPasswordResetConfirmPassword('');
  };

  const submitPasswordResetRequest = async (event) => {
    event.preventDefault();
    setPasswordResetLoading(true);
    setPasswordResetError('');
    setPasswordResetSuccess('');
    setPasswordResetStatus(null);
    setPasswordResetCanChange(false);

    try {
      const response = await API.requestPasswordReset(passwordResetIdentifier.trim());
      if (response?.status) {
        applyPasswordResetStatus(response);
        if (!PASSWORD_RESET_CHANGE_STATUSES.has(normalizePasswordResetStatus(response.status))) {
          setPasswordResetMode('status');
        }
      } else {
        setPasswordResetStatus({ status: 'pending' });
        setPasswordResetSuccess(response?.message || PASSWORD_RESET_REQUEST_SENT_MESSAGE);
        setPasswordResetMode('status');
      }
    } catch (err) {
      setPasswordResetError(err.message || 'Password reset request could not be sent.');
    } finally {
      setPasswordResetLoading(false);
    }
  };

  const checkPasswordResetStatus = async (event) => {
    event.preventDefault();
    setPasswordResetLoading(true);
    setPasswordResetError('');
    setPasswordResetSuccess('');

    try {
      const statusResult = await API.checkPasswordResetStatus(passwordResetIdentifier.trim());
      applyPasswordResetStatus(statusResult);
    } catch (err) {
      setPasswordResetCanChange(false);
      setPasswordResetError(err.message || 'Password reset status could not be checked.');
    } finally {
      setPasswordResetLoading(false);
    }
  };

  const submitPasswordResetAppeal = async (event) => {
    event.preventDefault();
    setPasswordResetLoading(true);
    setPasswordResetError('');
    setPasswordResetSuccess('');

    const reason = passwordResetAppealReason.trim();
    if (!reason) {
      setPasswordResetError('Enter your reason for appeal.');
      setPasswordResetLoading(false);
      return;
    }

    try {
      const statusResult = await API.appealPasswordReset({
        usernameOrEmail: passwordResetIdentifier.trim(),
        reason,
      });
      applyPasswordResetStatus(statusResult);
      setPasswordResetMode('status');
      setPasswordResetAppealReason('');
    } catch (err) {
      setPasswordResetError(err.message || 'Appeal could not be submitted.');
    } finally {
      setPasswordResetLoading(false);
    }
  };

  const submitApprovedPasswordChange = async (event) => {
    event.preventDefault();
    setPasswordResetLoading(true);
    setPasswordResetError('');
    setPasswordResetSuccess('');

    if (!passwordResetCanChange) {
      setPasswordResetError('Please check your request status first. Password changes are only available after admin approval.');
      setPasswordResetLoading(false);
      return;
    }

    if (passwordResetNewPassword !== passwordResetConfirmPassword) {
      setPasswordResetError('Passwords do not match.');
      setPasswordResetLoading(false);
      return;
    }

    try {
      const identifier = passwordResetIdentifier.trim();
      await API.completePasswordReset({
        identifier,
        new_password: passwordResetNewPassword,
      });
      setUsername(identifier);
      setPassword('');
      setPasswordResetOpen(false);
      setPasswordResetNewPassword('');
      setPasswordResetConfirmPassword('');
      setPasswordResetStatus({ status: 'used' });
      setPasswordResetCanChange(false);
      window.showToast?.('Password changed. Sign in with your new password.', 'success');
    } catch (err) {
      setPasswordResetError(err.message || 'Password could not be changed yet.');
    } finally {
      setPasswordResetLoading(false);
    }
  };

  const openAuthenticatorRecovery = (mode = 'request') => {
    setAuthRecoveryMode(mode === 'setup' && !authRecoveryCanSetup ? 'status' : mode);
    setAuthRecoveryIdentifier(username.trim());
    setAuthRecoveryReason('');
    setAuthRecoveryAppealReason('');
    setAuthRecoveryError('');
    setAuthRecoverySuccess('');
    setAuthRecoveryStatus(null);
    setAuthRecoveryCanSetup(false);
    setAuthRecoveryOpen(true);
  };

  const closeAuthenticatorRecovery = () => {
    if (authRecoveryLoading) {
      return;
    }

    setAuthRecoveryOpen(false);
    setAuthRecoveryError('');
    setAuthRecoverySuccess('');
    setAuthRecoveryReason('');
    setAuthRecoveryAppealReason('');
    setAuthRecoveryStatus(null);
    setAuthRecoveryCanSetup(false);
  };

  const applyAuthenticatorRecoveryStatus = (statusResult) => {
    const status = normalizePasswordResetStatus(statusResult?.status);
    const normalizedResult = { ...(statusResult || {}), status };

    setAuthRecoveryStatus(normalizedResult);
    setAuthRecoverySuccess(getAuthenticatorRecoveryMessage(normalizedResult));
    setAuthRecoveryError('');

    if (AUTHENTICATOR_RECOVERY_SETUP_STATUSES.has(status)) {
      setAuthRecoveryCanSetup(true);
      setAuthRecoveryMode('setup');
      return;
    }

    setAuthRecoveryCanSetup(false);
  };

  const updateAuthenticatorRecoveryIdentifier = (value) => {
    setAuthRecoveryIdentifier(value);
    setAuthRecoveryCanSetup(false);
    setAuthRecoveryStatus(null);
    setAuthRecoveryError('');
    setAuthRecoverySuccess('');
    setAuthRecoveryAppealReason('');
  };

  const submitAuthenticatorRecoveryRequest = async (event) => {
    event.preventDefault();
    setAuthRecoveryLoading(true);
    setAuthRecoveryError('');
    setAuthRecoverySuccess('');
    setAuthRecoveryStatus(null);
    setAuthRecoveryCanSetup(false);

    const reason = authRecoveryReason.trim();
    if (!reason) {
      setAuthRecoveryError('Enter your reason for authenticator recovery.');
      setAuthRecoveryLoading(false);
      return;
    }

    try {
      const response = await API.requestAuthenticatorRecovery({
        usernameOrEmail: authRecoveryIdentifier.trim(),
        reason,
      });
      if (response?.status) {
        applyAuthenticatorRecoveryStatus(response);
        if (!AUTHENTICATOR_RECOVERY_SETUP_STATUSES.has(normalizePasswordResetStatus(response.status))) {
          setAuthRecoveryMode('status');
        }
      } else {
        setAuthRecoveryStatus({ status: 'pending' });
        setAuthRecoverySuccess(response?.message || AUTHENTICATOR_RECOVERY_REQUEST_SENT_MESSAGE);
        setAuthRecoveryMode('status');
      }
    } catch (err) {
      setAuthRecoveryError(err.message || 'Authenticator recovery request could not be sent.');
    } finally {
      setAuthRecoveryLoading(false);
    }
  };

  const checkAuthenticatorRecoveryStatus = async (event) => {
    event.preventDefault();
    setAuthRecoveryLoading(true);
    setAuthRecoveryError('');
    setAuthRecoverySuccess('');

    try {
      const statusResult = await API.checkAuthenticatorRecoveryStatus(authRecoveryIdentifier.trim());
      applyAuthenticatorRecoveryStatus(statusResult);
    } catch (err) {
      setAuthRecoveryCanSetup(false);
      setAuthRecoveryError(err.message || 'Authenticator recovery status could not be checked.');
    } finally {
      setAuthRecoveryLoading(false);
    }
  };

  const submitAuthenticatorRecoveryAppeal = async (event) => {
    event.preventDefault();
    setAuthRecoveryLoading(true);
    setAuthRecoveryError('');
    setAuthRecoverySuccess('');

    const reason = authRecoveryAppealReason.trim();
    if (!reason) {
      setAuthRecoveryError('Enter your reason for appeal.');
      setAuthRecoveryLoading(false);
      return;
    }

    try {
      const statusResult = await API.appealAuthenticatorRecovery({
        usernameOrEmail: authRecoveryIdentifier.trim(),
        reason,
      });
      applyAuthenticatorRecoveryStatus(statusResult);
      setAuthRecoveryMode('status');
      setAuthRecoveryAppealReason('');
    } catch (err) {
      setAuthRecoveryError(err.message || 'Appeal could not be submitted.');
    } finally {
      setAuthRecoveryLoading(false);
    }
  };

  const startApprovedAuthenticatorSetup = async (event) => {
    event.preventDefault();
    setAuthRecoveryLoading(true);
    setAuthRecoveryError('');
    setAuthRecoverySuccess('');

    if (!authRecoveryCanSetup) {
      setAuthRecoveryError('Check your recovery request status first. Setup is available after admin approval.');
      setAuthRecoveryLoading(false);
      return;
    }

    try {
      const identifier = authRecoveryIdentifier.trim();
      const response = await API.startAuthenticatorRecoverySetup(identifier);
      setUsername(identifier);
      setAuthenticatorChallenge(response);
      setAuthenticatorCode('');
      setSecretCopied(false);
      setAuthRecoveryOpen(false);
      setAuthRecoveryStatus(null);
      setAuthRecoveryCanSetup(false);
    } catch (err) {
      setAuthRecoveryError(err.message || 'New authenticator setup could not be started yet.');
    } finally {
      setAuthRecoveryLoading(false);
    }
  };

  const currentPasswordResetStatus = normalizePasswordResetStatus(passwordResetStatus?.status);
  const canAppealPasswordReset = currentPasswordResetStatus === 'declined';
  const currentAuthRecoveryStatus = normalizePasswordResetStatus(authRecoveryStatus?.status);
  const canAppealAuthenticatorRecovery = currentAuthRecoveryStatus === 'declined';

  return (
    <div className="login-view relative min-h-[100dvh] w-full overflow-y-auto overflow-x-hidden bg-slate-950 text-slate-100 flex flex-col justify-center items-center px-4 py-8 sm:px-6 lg:px-8 selection:bg-emerald-500/30 selection:text-emerald-200">
      {/* Ambient background glowing lighting effects */}
      <div className="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-emerald-500/15 blur-[120px] pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 h-[500px] w-[500px] rounded-full bg-teal-500/15 blur-[140px] pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] rounded-full bg-emerald-600/5 blur-[160px] pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:24px_24px] pointer-events-none" />

      {/* Main card container */}
      <div className="relative z-10 w-full max-w-md my-auto">
        <div className="relative overflow-hidden rounded-3xl border border-slate-800/90 bg-slate-900/85 p-6 sm:p-9 shadow-2xl shadow-black/60 backdrop-blur-2xl transition-all duration-300">
          {/* Subtle top card glow accent border */}
          <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-emerald-400/50 to-transparent" />

          {/* Brand Header */}
          <div className="flex flex-col items-center text-center">
            <div className="relative mb-4">
              <div className="absolute -inset-2 rounded-2xl bg-emerald-500/25 blur-lg animate-pulse" />
              <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-500/30 bg-slate-900/90 p-3 shadow-xl backdrop-blur-md">
                <BrandLogo className="h-10 w-10 drop-shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
              </div>
            </div>
            <h1 className="text-3xl font-black tracking-tight bg-gradient-to-r from-white via-slate-100 to-emerald-400 bg-clip-text text-transparent">
              MEALS
            </h1>
            <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-0.5 text-[11px] font-bold uppercase tracking-wider text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Operations Workspace
            </div>
            <p className="mt-2 text-xs text-slate-400 leading-relaxed max-w-xs">
              Sign in with your workspace credentials to access inventory, sales, and canteen intelligence.
            </p>
          </div>

          {/* Role Quick-Select Pills */}
          <div className="mt-5 flex items-center justify-center gap-1.5">
            {[
              { id: 'admin', label: 'Admin', pass: 'admin123' },
              { id: 'staff', label: 'Staff', pass: 'staff123' },
              { id: 'cashier', label: 'Cashier', pass: 'cashier123' },
            ].map((roleItem) => (
              <button
                key={roleItem.id}
                type="button"
                onClick={() => {
                  setUsername(roleItem.id);
                  setPassword(roleItem.pass);
                  setError('');
                }}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider transition-all duration-150 ${
                  username.toLowerCase() === roleItem.id
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-xs'
                    : 'bg-slate-800/60 text-slate-400 border border-slate-700/50 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                {roleItem.label}
              </button>
            ))}
          </div>

          {/* Lockout & Alert notifications */}
          <div className="mt-5 space-y-3">
            {lockoutState.isLocked && (
              <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs font-medium leading-relaxed text-amber-300 backdrop-blur-xs">
                <div className="font-bold text-amber-200 flex items-center gap-1.5 text-sm">
                  ⚠️ Too many failed attempts
                </div>
                <div className="mt-1">
                  This account is temporarily locked. Try again in <span className="font-bold text-white">{lockoutRemainingLabel}</span>.
                </div>
              </div>
            )}
            {error && !isAuthenticatorStep && pendingRecoveryCodes.length === 0 && (
              <DismissibleAlert resetKey={error} tone="red" title="Sign-in issue" className="rounded-2xl">
                {error}
              </DismissibleAlert>
            )}
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-300">
                <UserIcon className="h-3.5 w-3.5 text-emerald-400" />
                <span>Username</span>
              </label>
              <div className="relative mt-1.5">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-500">
                  <UserIcon className="h-4 w-4" />
                </div>
                <input
                  type="text"
                  required
                  placeholder="Enter your username"
                  className="w-full rounded-xl border border-slate-700/80 bg-slate-950/70 pl-10 pr-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-hidden transition duration-200 focus:border-emerald-500 focus:bg-slate-950 focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  value={username}
                  onChange={handleUsernameChange}
                  disabled={loading || isAuthenticatorStep || lockoutState.isLocked}
                  autoComplete="username"
                />
              </div>
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-300">
                <LockClosedIcon className="h-3.5 w-3.5 text-emerald-400" />
                <span>Password</span>
              </label>
              <div className="relative mt-1.5">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-500">
                  <LockClosedIcon className="h-4 w-4" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="Enter your password"
                  className="w-full rounded-xl border border-slate-700/80 bg-slate-950/70 pl-10 pr-10 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-hidden transition duration-200 focus:border-emerald-500 focus:bg-slate-950 focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading || isAuthenticatorStep || lockoutState.isLocked}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-500 hover:text-slate-300 transition"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeSlashIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2.5 pt-1 sm:flex-row sm:items-center sm:justify-between text-xs">
              <label className="flex items-center gap-2 font-medium text-slate-400 cursor-pointer select-none hover:text-slate-300 transition">
                <input
                  type="checkbox"
                  checked={rememberUsername}
                  onChange={(event) => setRememberUsername(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-emerald-500 focus:ring-emerald-500/30 accent-emerald-500 cursor-pointer"
                />
                Remember me
              </label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => openAuthenticatorRecovery('request')}
                  className="font-medium text-slate-400 hover:text-slate-200 transition"
                >
                  2FA Recovery
                </button>
                <span className="text-slate-700">•</span>
                <button
                  type="button"
                  onClick={() => openPasswordReset('request')}
                  className="font-semibold text-emerald-400 hover:text-emerald-300 transition"
                >
                  Forgot password?
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={
                loading ||
                lockoutState.isLocked ||
                !username ||
                !password ||
                isAuthenticatorVerificationLocked ||
                (isAuthenticatorStep && !canSubmitAuthenticatorCode)
              }
              className="group relative mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-600 py-3 px-4 text-sm font-bold text-white shadow-lg shadow-emerald-600/25 transition-all duration-200 hover:from-emerald-500 hover:to-teal-500 hover:shadow-emerald-500/35 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
            >
              {lockoutState.isLocked ? (
                `Locked for ${lockoutRemainingLabel}`
              ) : loading ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Authenticating...
                </span>
              ) : isAuthenticatorSetup ? (
                'Set Up & Sign In'
              ) : isAuthenticatorStep ? (
                'Verify Code'
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRightIcon className="h-4 w-4 stroke-[2.5] transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </form>
        </div>

        {/* Footer info */}
        <div className="mt-6 text-center text-[11px] text-slate-500 font-mono">
          MEALS Desktop • LSPU-SPCC 4WMAD1
        </div>
      </div>

      {passwordResetOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-5 backdrop-blur-md animate-in fade-in duration-200">
          <div
            className="w-full max-w-[32rem] overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 text-slate-100 shadow-2xl shadow-black/80"
            role="dialog"
            aria-modal="true"
            aria-labelledby="password-reset-title"
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 bg-slate-950/60 px-6 py-5">
              <div className="min-w-0">
                <h3 id="password-reset-title" className="text-xl font-bold leading-7 text-white flex items-center gap-2">
                  <KeyIcon className="h-5 w-5 text-emerald-400" />
                  Forgot password
                </h3>
                <p className="mt-1 text-xs leading-5 text-slate-400">
                  Send a request to admin, then change your password once approved.
                </p>
              </div>
              <button
                type="button"
                onClick={closePasswordReset}
                disabled={passwordResetLoading}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Close password reset"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[calc(100dvh-8rem)] overflow-y-auto px-6 py-5">
              <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-800 bg-slate-950/80 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setPasswordResetMode('request');
                    setPasswordResetError('');
                    setPasswordResetSuccess('');
                  }}
                  className={`rounded-lg px-3 py-2 text-xs font-bold transition ${
                    passwordResetMode === 'request'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Request
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPasswordResetMode('status');
                    setPasswordResetError('');
                    setPasswordResetSuccess('');
                  }}
                  className={`rounded-lg px-3 py-2 text-xs font-bold transition ${
                    passwordResetMode === 'status'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Status
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!passwordResetCanChange) {
                      setPasswordResetMode('status');
                      setPasswordResetError('');
                      setPasswordResetSuccess('Check your request status first. Change Password is available after admin approval.');
                      setPasswordResetStatus({ status: 'pending' });
                      return;
                    }
                    setPasswordResetMode('change');
                    setPasswordResetError('');
                    setPasswordResetSuccess('');
                  }}
                  disabled={!passwordResetCanChange}
                  className={`rounded-lg px-3 py-2 text-xs font-bold transition ${
                    passwordResetMode === 'change'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  } disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:text-slate-600`}
                >
                  Change
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {passwordResetError && (
                  <DismissibleAlert resetKey={passwordResetError} tone="red" title="Recovery issue" className="rounded-2xl">
                    {passwordResetError}
                  </DismissibleAlert>
                )}
                {passwordResetSuccess && (
                  <DismissibleAlert
                    resetKey={passwordResetSuccess}
                    tone={getPasswordResetTone(passwordResetStatus)}
                    title="Request status"
                    className="rounded-2xl"
                  >
                    <div
                      id={
                        currentPasswordResetStatus === 'declined'
                          ? 'decline-message'
                          : currentPasswordResetStatus === 'appealed'
                            ? 'appeal-sent'
                            : currentPasswordResetStatus === 'appeal_declined'
                              ? 'appeal-declined'
                              : undefined
                      }
                    >
                      {passwordResetSuccess}
                    </div>
                    {passwordResetStatus?.review_note && (
                      <div className="mt-1 font-semibold">Decline reason: {passwordResetStatus.review_note}</div>
                    )}
                    {passwordResetStatus?.appeal_review_note && (
                      <div className="mt-1 font-semibold">Appeal note: {passwordResetStatus.appeal_review_note}</div>
                    )}
                  </DismissibleAlert>
                )}
                {canAppealPasswordReset && passwordResetMode !== 'appeal' && (
                  <button
                    type="button"
                    onClick={() => {
                      setPasswordResetMode('appeal');
                      setPasswordResetError('');
                      setPasswordResetSuccess('');
                    }}
                    className="inline-flex w-full items-center justify-center rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs font-bold text-amber-300 transition hover:bg-amber-500/20"
                  >
                    Appeal Decision
                  </button>
                )}
              </div>

              {passwordResetMode === 'request' ? (
                <form onSubmit={submitPasswordResetRequest} className="mt-5 space-y-4">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-300">
                      Username or email
                    </label>
                    <input
                      type="text"
                      required
                      value={passwordResetIdentifier}
                      onChange={(event) => updatePasswordResetIdentifier(event.target.value)}
                      placeholder="Enter your username or email"
                      className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-hidden transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                      autoComplete="username"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={passwordResetLoading || !passwordResetIdentifier.trim()}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-3 text-sm font-bold text-white shadow-md shadow-emerald-600/20 transition hover:from-emerald-500 hover:to-teal-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {passwordResetLoading ? 'Sending...' : 'Send Reset Request'}
                  </button>
                </form>
              ) : passwordResetMode === 'status' ? (
                <form onSubmit={checkPasswordResetStatus} className="mt-5 space-y-4">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-300">
                      Username or email
                    </label>
                    <input
                      type="text"
                      required
                      value={passwordResetIdentifier}
                      onChange={(event) => updatePasswordResetIdentifier(event.target.value)}
                      placeholder="Enter your username or email"
                      className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-hidden transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                      autoComplete="username"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={passwordResetLoading || !passwordResetIdentifier.trim()}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-3 text-sm font-bold text-white shadow-md shadow-emerald-600/20 transition hover:from-emerald-500 hover:to-teal-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {passwordResetLoading ? 'Checking...' : 'Check Status'}
                  </button>
                </form>
              ) : passwordResetMode === 'appeal' ? (
                <form onSubmit={submitPasswordResetAppeal} className="mt-5 space-y-4">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-300">
                      Username or email
                    </label>
                    <input
                      type="text"
                      required
                      value={passwordResetIdentifier}
                      onChange={(event) => updatePasswordResetIdentifier(event.target.value)}
                      placeholder="Enter your username or email"
                      className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-hidden transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                      autoComplete="username"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-300">
                      Appeal reason
                    </label>
                    <textarea
                      id="appeal-placeholder"
                      required
                      rows={4}
                      value={passwordResetAppealReason}
                      onChange={(event) => setPasswordResetAppealReason(event.target.value)}
                      placeholder="Enter your reason for appeal..."
                      className="mt-1.5 w-full resize-none rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-hidden transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => {
                        setPasswordResetMode('status');
                        setPasswordResetError('');
                        setPasswordResetSuccess(getPasswordResetMessage(passwordResetStatus));
                      }}
                      disabled={passwordResetLoading}
                      className="flex w-full items-center justify-center rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-3 text-sm font-semibold text-slate-300 transition hover:bg-slate-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={
                        passwordResetLoading ||
                        !passwordResetIdentifier.trim() ||
                        !passwordResetAppealReason.trim()
                      }
                      className="flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-3 text-sm font-bold text-white shadow-md shadow-emerald-600/20 transition hover:from-emerald-500 hover:to-teal-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {passwordResetLoading ? 'Submitting...' : 'Submit Appeal'}
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={submitApprovedPasswordChange} className="mt-5 space-y-4">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-300">
                      Username or email
                    </label>
                    <input
                      type="text"
                      required
                      value={passwordResetIdentifier}
                      onChange={(event) => updatePasswordResetIdentifier(event.target.value)}
                      placeholder="Enter your username or email"
                      className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-hidden transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                      autoComplete="username"
                    />
                  </div>
                  {!passwordResetCanChange && (
                    <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs font-semibold text-amber-300">
                      Check your request status first. You can change your password only after admin approval.
                    </div>
                  )}
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-300">
                      New password
                    </label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={passwordResetNewPassword}
                      onChange={(event) => setPasswordResetNewPassword(event.target.value)}
                      placeholder="At least 6 characters"
                      className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-hidden transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                      autoComplete="new-password"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-300">
                      Confirm password
                    </label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={passwordResetConfirmPassword}
                      onChange={(event) => setPasswordResetConfirmPassword(event.target.value)}
                      placeholder="Re-enter new password"
                      className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-hidden transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                      autoComplete="new-password"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={
                      passwordResetLoading ||
                      !passwordResetCanChange ||
                      !passwordResetIdentifier.trim() ||
                      !passwordResetNewPassword ||
                      !passwordResetConfirmPassword
                    }
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-3 text-sm font-bold text-white shadow-md shadow-emerald-600/20 transition hover:from-emerald-500 hover:to-teal-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {passwordResetLoading ? 'Changing...' : 'Change Password'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {authRecoveryOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-5 backdrop-blur-md animate-in fade-in duration-200">
          <div
            className="w-full max-w-[32rem] overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 text-slate-100 shadow-2xl shadow-black/80"
            role="dialog"
            aria-modal="true"
            aria-labelledby="authenticator-recovery-title"
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 bg-slate-950/60 px-6 py-5">
              <div className="min-w-0">
                <h3 id="authenticator-recovery-title" className="text-xl font-bold leading-7 text-white flex items-center gap-2">
                  <ShieldCheckIcon className="h-5 w-5 text-emerald-400" />
                  Authenticator Recovery
                </h3>
                <p className="mt-1 text-xs leading-5 text-slate-400">
                  Request admin approval to set up a new authenticator app.
                </p>
              </div>
              <button
                type="button"
                onClick={closeAuthenticatorRecovery}
                disabled={authRecoveryLoading}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Close authenticator recovery"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[calc(100dvh-8rem)] overflow-y-auto px-6 py-5">
              <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-800 bg-slate-950/80 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setAuthRecoveryMode('request');
                    setAuthRecoveryError('');
                    setAuthRecoverySuccess('');
                  }}
                  className={`rounded-lg px-3 py-2 text-xs font-bold transition ${
                    authRecoveryMode === 'request'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Request
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthRecoveryMode('status');
                    setAuthRecoveryError('');
                    setAuthRecoverySuccess('');
                  }}
                  className={`rounded-lg px-3 py-2 text-xs font-bold transition ${
                    authRecoveryMode === 'status'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Status
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!authRecoveryCanSetup) {
                      setAuthRecoveryMode('status');
                      setAuthRecoveryError('');
                      setAuthRecoverySuccess('Check your recovery request status first. Setup is available after admin approval.');
                      setAuthRecoveryStatus({ status: 'pending' });
                      return;
                    }
                    setAuthRecoveryMode('setup');
                    setAuthRecoveryError('');
                    setAuthRecoverySuccess('');
                  }}
                  disabled={!authRecoveryCanSetup}
                  className={`rounded-lg px-3 py-2 text-xs font-bold transition ${
                    authRecoveryMode === 'setup'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  } disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:text-slate-600`}
                >
                  Setup
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {authRecoveryError && (
                  <DismissibleAlert resetKey={authRecoveryError} tone="red" title="Recovery issue" className="rounded-2xl">
                    {authRecoveryError}
                  </DismissibleAlert>
                )}
                {authRecoverySuccess && (
                  <DismissibleAlert
                    resetKey={authRecoverySuccess}
                    tone={getAuthenticatorRecoveryTone(authRecoveryStatus)}
                    title="Request status"
                    className="rounded-2xl"
                  >
                    <div>{authRecoverySuccess}</div>
                    {authRecoveryStatus?.review_note && (
                      <div className="mt-1 font-semibold">Decline reason: {authRecoveryStatus.review_note}</div>
                    )}
                    {authRecoveryStatus?.appeal_review_note && (
                      <div className="mt-1 font-semibold">Appeal note: {authRecoveryStatus.appeal_review_note}</div>
                    )}
                  </DismissibleAlert>
                )}
                {canAppealAuthenticatorRecovery && authRecoveryMode !== 'appeal' && (
                  <button
                    type="button"
                    onClick={() => {
                      setAuthRecoveryMode('appeal');
                      setAuthRecoveryError('');
                      setAuthRecoverySuccess('');
                    }}
                    className="inline-flex w-full items-center justify-center rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs font-bold text-amber-300 transition hover:bg-amber-500/20"
                  >
                    Appeal Decision
                  </button>
                )}
              </div>

              {authRecoveryMode === 'request' ? (
                <form onSubmit={submitAuthenticatorRecoveryRequest} className="mt-5 space-y-4">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-300">
                      Username or email
                    </label>
                    <input
                      type="text"
                      required
                      value={authRecoveryIdentifier}
                      onChange={(event) => updateAuthenticatorRecoveryIdentifier(event.target.value)}
                      placeholder="Enter your username or email"
                      className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-hidden transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                      autoComplete="username"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-300">
                      Recovery reason
                    </label>
                    <textarea
                      required
                      rows={4}
                      value={authRecoveryReason}
                      onChange={(event) => setAuthRecoveryReason(event.target.value)}
                      placeholder="Tell the admin why you need authenticator recovery"
                      className="mt-1.5 w-full resize-none rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-hidden transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={authRecoveryLoading || !authRecoveryIdentifier.trim() || !authRecoveryReason.trim()}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-3 text-sm font-bold text-white shadow-md shadow-emerald-600/20 transition hover:from-emerald-500 hover:to-teal-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {authRecoveryLoading ? 'Sending...' : 'Send Recovery Request'}
                  </button>
                </form>
              ) : authRecoveryMode === 'status' ? (
                <form onSubmit={checkAuthenticatorRecoveryStatus} className="mt-5 space-y-4">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-300">
                      Username or email
                    </label>
                    <input
                      type="text"
                      required
                      value={authRecoveryIdentifier}
                      onChange={(event) => updateAuthenticatorRecoveryIdentifier(event.target.value)}
                      placeholder="Enter your username or email"
                      className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-hidden transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                      autoComplete="username"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={authRecoveryLoading || !authRecoveryIdentifier.trim()}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-3 text-sm font-bold text-white shadow-md shadow-emerald-600/20 transition hover:from-emerald-500 hover:to-teal-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {authRecoveryLoading ? 'Checking...' : 'Check Status'}
                  </button>
                </form>
              ) : authRecoveryMode === 'appeal' ? (
                <form onSubmit={submitAuthenticatorRecoveryAppeal} className="mt-5 space-y-4">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-300">
                      Username or email
                    </label>
                    <input
                      type="text"
                      required
                      value={authRecoveryIdentifier}
                      onChange={(event) => updateAuthenticatorRecoveryIdentifier(event.target.value)}
                      placeholder="Enter your username or email"
                      className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-hidden transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                      autoComplete="username"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-300">
                      Appeal reason
                    </label>
                    <textarea
                      required
                      rows={4}
                      value={authRecoveryAppealReason}
                      onChange={(event) => setAuthRecoveryAppealReason(event.target.value)}
                      placeholder="Enter your reason for appeal..."
                      className="mt-1.5 w-full resize-none rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-hidden transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => {
                        setAuthRecoveryMode('status');
                        setAuthRecoveryError('');
                        setAuthRecoverySuccess(getAuthenticatorRecoveryMessage(authRecoveryStatus));
                      }}
                      disabled={authRecoveryLoading}
                      className="flex w-full items-center justify-center rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-3 text-sm font-semibold text-slate-300 transition hover:bg-slate-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={
                        authRecoveryLoading ||
                        !authRecoveryIdentifier.trim() ||
                        !authRecoveryAppealReason.trim()
                      }
                      className="flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-3 text-sm font-bold text-white shadow-md shadow-emerald-600/20 transition hover:from-emerald-500 hover:to-teal-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {authRecoveryLoading ? 'Submitting...' : 'Submit Appeal'}
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={startApprovedAuthenticatorSetup} className="mt-5 space-y-4">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-300">
                      Username or email
                    </label>
                    <input
                      type="text"
                      required
                      value={authRecoveryIdentifier}
                      onChange={(event) => updateAuthenticatorRecoveryIdentifier(event.target.value)}
                      placeholder="Enter your username or email"
                      className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-hidden transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                      autoComplete="username"
                    />
                  </div>
                  {!authRecoveryCanSetup && (
                    <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs font-semibold text-amber-300">
                      Check your request status first. You can set up a new authenticator only after admin approval.
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={authRecoveryLoading || !authRecoveryCanSetup || !authRecoveryIdentifier.trim()}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-3 text-sm font-bold text-white shadow-md shadow-emerald-600/20 transition hover:from-emerald-500 hover:to-teal-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {authRecoveryLoading ? 'Starting...' : 'Set Up New Authenticator'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {isAuthenticatorStep && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-5 backdrop-blur-md animate-in fade-in duration-200">
          <div
            className="w-full max-w-[30rem] overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 text-slate-100 shadow-2xl shadow-black/80"
            role="dialog"
            aria-modal="true"
            aria-labelledby="authenticator-modal-title"
          >
            <div className="border-b border-slate-800 bg-slate-950/60 px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 id="authenticator-modal-title" className="text-xl font-bold leading-7 text-white flex items-center gap-2">
                    <ShieldCheckIcon className="h-5 w-5 text-emerald-400" />
                    {isAuthenticatorSetup ? 'Set up verification' : 'Two-Factor Verification'}
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    {isAuthenticatorSetup
                      ? 'Add MEALS to your authenticator app, then enter the 6-digit code.'
                      : 'Open your authenticator app and enter the current 6-digit code.'}
                  </p>
                </div>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="max-h-[calc(100dvh-8rem)] overflow-y-auto px-6 py-5">
              {error && (
                <DismissibleAlert
                  resetKey={`${authenticatorErrorTitle}-${error}-${authenticatorCode}`}
                  tone="red"
                  title={authenticatorErrorTitle || (isAuthenticatorSetup ? 'Authenticator setup issue' : 'Verification issue')}
                  className="mb-4 rounded-2xl"
                >
                  {error}
                </DismissibleAlert>
              )}

              {isAuthenticatorSetup && (
                <div className="mb-4 grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)] items-center">
                  {authenticatorQrCode && (
                    <div className="mx-auto rounded-2xl bg-white p-2.5 sm:mx-0 shadow-lg border border-slate-700">
                      <img
                        src={authenticatorQrCode}
                        alt="Authenticator setup QR code"
                        className="h-32 w-32"
                      />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-xs leading-relaxed text-slate-400">
                      Scan the QR code or enter this setup key in Google Authenticator, Microsoft Authenticator, or another TOTP app.
                    </div>
                    <div className="mt-2 break-all rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs font-bold tracking-wider text-emerald-400">
                      {authenticatorChallenge?.authenticator?.secret_formatted}
                    </div>
                    <button
                      type="button"
                      onClick={copySetupKey}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-300 transition hover:bg-slate-700 hover:text-white"
                    >
                      {secretCopied ? '✓ Key Copied' : 'Copy Key'}
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-300">
                  6-digit code or recovery code
                </label>
                <input
                  ref={authenticatorCodeRef}
                  type="text"
                  inputMode={isAuthenticatorSetup ? 'numeric' : 'text'}
                  required
                  placeholder={isAuthenticatorSetup ? '000000' : '000000 or code'}
                  className="mt-2 w-full rounded-2xl border border-slate-700/80 bg-slate-950 px-4 py-3.5 text-center font-mono text-2xl sm:text-3xl font-bold tracking-[0.25em] text-emerald-400 outline-hidden transition placeholder:text-slate-600 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  value={authenticatorCode}
                  onChange={(event) =>
                    setAuthenticatorCode(normalizeAuthenticatorCode(event.target.value, {
                      setup: isAuthenticatorSetup,
                    }))
                  }
                  disabled={loading || isAuthenticatorVerificationLocked}
                  autoComplete="one-time-code"
                />
                {!isAuthenticatorSetup && (
                  <span className="mt-2.5 block text-xs leading-5 text-slate-400">
                    Lost your authenticator app? Enter one saved recovery code here, or{' '}
                    <button
                      type="button"
                      onClick={() => openAuthenticatorRecovery('request')}
                      className="font-semibold text-emerald-400 hover:text-emerald-300 transition"
                    >
                      request authenticator recovery
                    </button>
                    .
                  </span>
                )}
              </div>

              <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={resetAuthenticatorStep}
                  disabled={loading}
                  className="rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-3 text-xs font-bold text-slate-300 transition hover:bg-slate-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Use different account
                </button>
                <button
                  type="submit"
                  disabled={loading || isAuthenticatorVerificationLocked || !canSubmitAuthenticatorCode}
                  className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-600/25 transition hover:from-emerald-500 hover:to-teal-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isAuthenticatorVerificationLocked ? (
                    `Locked for ${authenticatorLockRemainingLabel}`
                  ) : loading ? (
                    <>
                      <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-5 backdrop-blur-md animate-in fade-in duration-200">
          <div
            className="w-full max-w-[32rem] overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 text-slate-100 shadow-2xl shadow-black/80"
            role="dialog"
            aria-modal="true"
            aria-labelledby="recovery-codes-title"
          >
            <div className="border-b border-slate-800 bg-slate-950/60 px-6 py-5">
              <h3 id="recovery-codes-title" className="text-xl font-bold leading-7 text-white flex items-center gap-2">
                <ShieldCheckIcon className="h-5 w-5 text-emerald-400" />
                Save your recovery codes
              </h3>
              <p className="mt-1 text-xs leading-5 text-slate-400">
                Each code works once if your authenticator app is deleted or unavailable.
              </p>
            </div>

            <div className="max-h-[calc(100dvh-8rem)] overflow-y-auto px-6 py-5">
              <div className="grid gap-2 sm:grid-cols-2">
                {pendingRecoveryCodes.map((code) => (
                  <div
                    key={code}
                    className="rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2.5 text-center font-mono text-sm font-bold tracking-wider text-emerald-400"
                  >
                    {code}
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-300">
                ⚠️ Store these codes in a password manager or secure location. They will not be shown again.
              </div>

              <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={copyRecoveryCodes}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-xs font-bold text-slate-300 transition hover:bg-slate-700 hover:text-white"
                >
                  {recoveryCodesCopied ? '✓ Copied Codes' : 'Copy All Codes'}
                </button>
                <button
                  type="button"
                  onClick={confirmRecoveryCodesSaved}
                  className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-3 text-sm font-bold text-white shadow-md shadow-emerald-600/20 transition hover:from-emerald-500 hover:to-teal-500 active:scale-[0.99]"
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
