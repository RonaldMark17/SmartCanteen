import { useEffect, useMemo, useState } from 'react';
import {
  ArrowPathIcon,
  BellIcon,
  CheckCircleIcon,
  Cog6ToothIcon,
  CommandLineIcon,
  ComputerDesktopIcon,
  EyeIcon,
  InformationCircleIcon,
  KeyIcon,
  LockClosedIcon,
  PaintBrushIcon,
  PowerIcon,
  ShieldCheckIcon,
  SparklesIcon,
  Squares2X2Icon,
  SunIcon,
  UserIcon,
} from '@heroicons/react/24/outline';
import DismissibleAlert from '../components/DismissibleAlert';
import { useModuleSettings } from '../contexts/useModuleSettings';
import { useAuth } from '../contexts/AuthContext';
import { useAccessibility } from '../contexts/AccessibilityContext';
import {
  DEFAULT_MODULE_VISIBILITY,
  MODULE_KEYS,
  SYSTEM_MODULES,
  normalizeModuleSettings,
} from '../config/modules';
import { API } from '../services/api';

const MODULE_DESCRIPTIONS = {
  [MODULE_KEYS.DASHBOARD]: 'Main workspace overview and shortcuts.',
  [MODULE_KEYS.FINANCIAL_REPORTS]: 'Monthly financial report layout, exports, and cash tracking.',
  [MODULE_KEYS.DAILY_SALES]: 'Daily sales totals and current-sales review.',
  [MODULE_KEYS.EXPENSE_MANAGEMENT]: 'Operating expenses and fund expense entries.',
  [MODULE_KEYS.SCHOOL_YEAR_MANAGEMENT]: 'School year setup and active reporting period.',
  [MODULE_KEYS.REPORTS]: 'Printable and exportable report outputs.',
  [MODULE_KEYS.USER_MANAGEMENT]: 'User accounts, roles, and authenticator recovery.',
  [MODULE_KEYS.AUDIT_LOGS]: 'Administrative activity history.',
  [MODULE_KEYS.SETTINGS]: 'System configuration and module management.',
  [MODULE_KEYS.POS]: 'Cashier checkout and order entry.',
  [MODULE_KEYS.TRANSACTIONS]: 'Sales transaction history and receipt records.',
  [MODULE_KEYS.INVENTORY]: 'Products, stock levels, and low-stock review.',
  [MODULE_KEYS.DEMAND_FORECAST]: 'Forecasting, restock planning, and demand reminders.',
  [MODULE_KEYS.ANALYTICS]: 'Charts, trends, best sellers, and performance views.',
  [MODULE_KEYS.NOTIFICATIONS]: 'In-app and phone reminders for stock, demand, and account notices.',
};

const LOCKED_ON_MODULES = new Set([MODULE_KEYS.SETTINGS]);

function areModuleSettingsEqual(left, right) {
  const normalizedLeft = normalizeModuleSettings(left);
  const normalizedRight = normalizeModuleSettings(right);

  return SYSTEM_MODULES.every(
    (module) => Boolean(normalizedLeft[module.key]) === Boolean(normalizedRight[module.key])
  );
}

function groupModules(modules) {
  return modules.reduce((groups, module) => {
    if (!groups[module.group]) {
      groups[module.group] = [];
    }
    groups[module.group].push(module);
    return groups;
  }, {});
}

function ModuleToggle({ module, enabled, disabled, onToggle }) {
  return (
    <button
      type="button"
      onClick={() => {
        if (!disabled) {
          onToggle(module.key);
        }
      }}
      disabled={disabled}
      aria-pressed={enabled}
      className={`flex w-full items-center justify-between gap-4 rounded-xl border p-4 text-left transition-all shadow-2xs ${
        enabled
          ? 'border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/40'
          : 'border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/80 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/60'
      } ${disabled ? 'cursor-not-allowed opacity-80' : ''}`}
    >
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-black text-slate-900 dark:text-white">{module.label}</span>
          {disabled ? (
            <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              Required
            </span>
          ) : null}
        </span>
        <span className="mt-1 block text-xs font-medium leading-5 text-slate-500 dark:text-slate-400">
          {MODULE_DESCRIPTIONS[module.key] || 'Workspace module'}
        </span>
      </span>

      <span
        className={`relative flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200 ${
          enabled ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'
        }`}
      >
        <span
          className={`h-6 w-6 rounded-full bg-white shadow-sm transition-transform duration-200 ${
            enabled ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </span>
    </button>
  );
}

export default function Settings() {
  const { user: authUser, role } = useAuth();
  const user = { ...(authUser || {}), role };
  const isAdmin = user.role === 'admin';

  const {
    settings: accSettings,
    updateSetting: updateAccSetting,
    resetSettings: resetAccSettings,
  } = useAccessibility();

  const {
    modules,
    loading,
    error,
    refreshModuleSettings,
    saveModuleSettings,
  } = useModuleSettings();

  const [draftModules, setDraftModules] = useState(() => normalizeModuleSettings(modules));
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Password reset request state
  const [pwResetLoading, setPwResetLoading] = useState(false);
  const [pwResetMessage, setPwResetMessage] = useState('');

  useEffect(() => {
    setDraftModules(normalizeModuleSettings(modules));
  }, [modules]);

  const groupedModules = useMemo(() => groupModules(SYSTEM_MODULES), []);
  const enabledCount = SYSTEM_MODULES.filter((module) => draftModules[module.key]).length;
  const disabledCount = SYSTEM_MODULES.length - enabledCount;
  const dirty = !areModuleSettingsEqual(draftModules, modules);

  async function handleRequestPasswordReset() {
    if (!user.username) return;
    setPwResetLoading(true);
    setPwResetMessage('');
    try {
      const res = await API.requestPasswordReset(user.username);
      setPwResetMessage(res.message || 'Password reset request submitted for administrator review.');
      window.showToast?.('Password reset request submitted.', 'success');
    } catch (err) {
      setPwResetMessage(err.message || 'Could not submit password reset request.');
      window.showToast?.(err.message || 'Failed to submit password reset request.', 'error');
    } finally {
      setPwResetLoading(false);
    }
  }

  function updateDraft(nextModules) {
    setSaveError('');
    setDraftModules({
      ...normalizeModuleSettings(nextModules),
      [MODULE_KEYS.SETTINGS]: true,
    });
  }

  function toggleModule(moduleKey) {
    if (LOCKED_ON_MODULES.has(moduleKey)) {
      return;
    }

    updateDraft({
      ...draftModules,
      [moduleKey]: !draftModules[moduleKey],
    });
  }

  async function handleRefresh() {
    setRefreshing(true);
    setSaveError('');
    try {
      await refreshModuleSettings();
      window.showToast?.('Module settings refreshed.', 'success');
    } catch (refreshError) {
      setSaveError(refreshError?.message || 'Module settings could not be refreshed.');
    } finally {
      setRefreshing(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaveError('');

    try {
      const nextModules = {
        ...draftModules,
        [MODULE_KEYS.SETTINGS]: true,
      };
      await saveModuleSettings(nextModules);
      window.showToast?.('Module settings saved.', 'success');
    } catch (saveException) {
      setSaveError(saveException?.message || 'Module settings could not be saved.');
      window.showToast?.('Module settings could not be saved.', 'error');
    } finally {
      setSaving(false);
    }
  }

  function handleResetAccessibility() {
    resetAccSettings();
    window.showToast?.('Accessibility preferences restored to default.', 'info');
  }

  return (
    <div className="view-shell overflow-x-hidden pr-0 space-y-6 pt-1">
      {/* 1. Page Header */}
      <div className="rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-200/80 bg-emerald-50/80 px-3 py-1 text-xs font-bold uppercase tracking-wider text-emerald-800 dark:border-emerald-800/80 dark:bg-emerald-950/60 dark:text-emerald-300">
              <ComputerDesktopIcon className="h-4 w-4" />
              Desktop App Settings
            </div>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white sm:text-3xl">
              Settings & Desktop Accessibility
            </h1>
            <p className="mt-1 text-sm font-medium leading-relaxed text-slate-600 dark:text-slate-400 max-w-3xl">
              {isAdmin
                ? 'Customize desktop interface scaling, visual accessibility, account security, and workspace system modules.'
                : 'Customize desktop interface scaling, visual accessibility options, and manage your account security.'}
            </p>
          </div>

          {isAdmin && (
            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={handleRefresh}
                disabled={loading || refreshing || saving}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200/90 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-50 active:scale-95 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                title="Reload module settings from server"
              >
                <ArrowPathIcon className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!dirty || loading || saving}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white shadow-sm shadow-emerald-600/20 transition hover:bg-emerald-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                title="Save module visibility changes"
              >
                <CheckCircleIcon className="h-4 w-4 stroke-[2.5]" />
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          )}
        </div>
      </div>

      {(error || saveError) && (
        <DismissibleAlert resetKey={`${error}-${saveError}`} tone="amber" className="rounded-xl">
          {saveError || error}
        </DismissibleAlert>
      )}

      {/* 2. User Profile Summary & Security Section */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* User Profile Card (4 cols) */}
        <div className="lg:col-span-4 flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <div>
            <div className="flex items-center gap-3.5 border-b border-slate-100 pb-4 dark:border-slate-800">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white font-black text-lg shadow-sm shadow-emerald-600/20">
                {(user.full_name || user.username || 'U').substring(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-base font-black text-slate-900 dark:text-white">
                  {user.full_name || user.username || 'User Profile'}
                </h3>
                <p className="truncate text-xs font-semibold text-slate-500 dark:text-slate-400">
                  @{user.username || 'user'}
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3 text-xs">
              <div className="flex items-center justify-between py-1">
                <span className="font-semibold text-slate-500 dark:text-slate-400">Role / Access Level</span>
                <span className="rounded-lg bg-emerald-50 px-2.5 py-1 font-black uppercase text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/60">
                  {user.role || 'Staff'}
                </span>
              </div>
              <div className="flex items-center justify-between py-1 border-t border-slate-100 dark:border-slate-800">
                <span className="font-semibold text-slate-500 dark:text-slate-400">Account Status</span>
                <span className="inline-flex items-center gap-1.5 font-bold text-emerald-600 dark:text-emerald-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  Active
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Account Password & Security Card (8 cols) */}
        <div className="lg:col-span-8 flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
              <LockClosedIcon className="h-4 w-4" />
              Account Security & Password
            </div>
            <h3 className="mt-1 text-base font-black text-slate-900 dark:text-white">
              Password Reset Request
            </h3>
            <p className="mt-1 text-xs font-medium leading-relaxed text-slate-600 dark:text-slate-400">
              Submit a password reset request if you need your password updated. An administrator will review and approve your request.
            </p>

            {pwResetMessage && (
              <div className="mt-3.5 rounded-xl border border-emerald-200/80 bg-emerald-50/70 p-3.5 text-xs font-bold text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                {pwResetMessage}
              </div>
            )}
          </div>

          <div className="mt-4 pt-3.5 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleRequestPasswordReset}
              disabled={pwResetLoading}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm shadow-emerald-600/20 transition hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
              title="Send a password reset request to administrator"
            >
              <KeyIcon className="h-4 w-4" />
              {pwResetLoading ? 'Submitting...' : 'Request Password Reset'}
            </button>
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Requires admin approval
            </span>
          </div>
        </div>
      </div>

      {/* 3. DESKTOP ACCESSIBILITY SETTINGS SECTION (Both Admin & Staff) */}
      <section className="rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-2xs dark:border-slate-800 dark:bg-slate-900 space-y-6">
        <div className="flex flex-col gap-3 border-b border-slate-100 pb-5 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-200/80 bg-emerald-50/80 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-emerald-800 dark:border-emerald-800/80 dark:bg-emerald-950/60 dark:text-emerald-300">
              <PaintBrushIcon className="h-4 w-4" />
              Accessibility Settings
            </div>
            <h2 className="mt-2 text-xl font-black text-slate-900 dark:text-white">
              Desktop Visual & Accessibility Options
            </h2>
            <p className="mt-1 text-xs font-medium leading-relaxed text-slate-600 dark:text-slate-400 max-w-3xl">
              Customize display scaling, text size, contrast, bold text, and keyboard navigation for Windows desktop displays (1366×768, 1920×1080 & higher). Saved per user account.
            </p>
          </div>

          <button
            type="button"
            onClick={handleResetAccessibility}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200/90 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-50 active:scale-95 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 shrink-0"
            title="Restore default accessibility settings"
          >
            <ArrowPathIcon className="h-4 w-4" />
            Reset Accessibility Settings
          </button>
        </div>

        {/* 1. Interface Scale (Desktop Layout Zoom) */}
        <div className="rounded-xl border border-slate-200/90 bg-slate-50/60 p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-850/60 space-y-3">
          <div>
            <span className="text-sm font-black text-slate-900 dark:text-white">Interface Scale</span>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Increase the overall size of text, buttons, cards, tables, and UI elements for high-resolution desktop screens.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { key: '100', label: 'Default (100%)', desc: 'Standard desktop view' },
              { key: '110', label: '110% Scale', desc: 'Slightly larger layout' },
              { key: '125', label: '125% Scale', desc: 'Medium desktop scale' },
              { key: '150', label: '150% Scale', desc: 'Large desktop scale' },
            ].map((option) => {
              const isSelected = accSettings.interfaceScale === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => updateAccSetting('interfaceScale', option.key)}
                  className={`flex flex-col items-center justify-center rounded-xl border py-3.5 px-3 min-h-[76px] text-center transition-all ${
                    isSelected
                      ? 'border-emerald-600 bg-emerald-50/90 text-emerald-950 ring-2 ring-emerald-500 shadow-xs dark:border-emerald-500 dark:bg-emerald-950/80 dark:text-emerald-100 font-bold'
                      : 'border-slate-200/90 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-700/80 dark:bg-slate-800 dark:text-slate-200'
                  }`}
                  title={`Set interface scaling to ${option.label}`}
                >
                  <span className="text-sm font-black leading-tight">{option.label}</span>
                  <span className={`mt-1 text-xs font-semibold leading-tight ${isSelected ? 'text-emerald-800 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400'}`}>
                    {option.desc}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. Text Size Options */}
        <div className="rounded-xl border border-slate-200/90 bg-slate-50/60 p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-850/60 space-y-3">
          <div>
            <span className="text-sm font-black text-slate-900 dark:text-white">Text Size</span>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Increase text size while maintaining proper layout, table alignment, and readability.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              { key: 'default', label: 'Default Text', desc: 'Standard font size' },
              { key: 'large', label: 'Large Text', desc: '115% larger font size' },
              { key: 'xlarge', label: 'Extra Large Text', desc: '130% larger font size' },
            ].map((option) => {
              const isSelected = accSettings.textSize === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => updateAccSetting('textSize', option.key)}
                  className={`flex flex-col items-center justify-center rounded-xl border py-3.5 px-3 min-h-[76px] text-center transition-all ${
                    isSelected
                      ? 'border-emerald-600 bg-emerald-50/90 text-emerald-950 ring-2 ring-emerald-500 shadow-xs dark:border-emerald-500 dark:bg-emerald-950/80 dark:text-emerald-100 font-bold'
                      : 'border-slate-200/90 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-700/80 dark:bg-slate-800 dark:text-slate-200'
                  }`}
                  title={`Set text size to ${option.label}`}
                >
                  <span className="text-sm font-black leading-tight">{option.label}</span>
                  <span className={`mt-1 text-xs font-semibold leading-tight ${isSelected ? 'text-emerald-800 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400'}`}>
                    {option.desc}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. Accessibility Toggles Grid */}
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
          {/* High Contrast Mode */}
          <div className="flex items-start justify-between gap-4 rounded-xl border border-slate-200/80 bg-white p-4 transition dark:border-slate-800 dark:bg-slate-850">
            <div className="flex items-start gap-3.5">
              <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300">
                <EyeIcon className="h-5 w-5 stroke-[2]" />
              </div>
              <div>
                <span className="text-sm font-black text-slate-900 dark:text-white">High Contrast</span>
                <p className="mt-0.5 text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
                  Improve contrast between text, backgrounds, borders, and UI controls.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => updateAccSetting('highContrast', !accSettings.highContrast)}
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200 ${
                accSettings.highContrast ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'
              }`}
              title="Toggle High Contrast Mode"
            >
              <span
                className={`inline-block h-6 w-6 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                  accSettings.highContrast ? 'translate-x-5.5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          {/* Reduce Motion */}
          <div className="flex items-start justify-between gap-4 rounded-xl border border-slate-200/80 bg-white p-4 transition dark:border-slate-800 dark:bg-slate-850">
            <div className="flex items-start gap-3.5">
              <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300">
                <SparklesIcon className="h-5 w-5 stroke-[2]" />
              </div>
              <div>
                <span className="text-sm font-black text-slate-900 dark:text-white">Reduce Motion</span>
                <p className="mt-0.5 text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
                  Reduce or disable unnecessary animations and screen transitions.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => updateAccSetting('reduceMotion', !accSettings.reduceMotion)}
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200 ${
                accSettings.reduceMotion ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'
              }`}
              title="Toggle Reduce Motion"
            >
              <span
                className={`inline-block h-6 w-6 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                  accSettings.reduceMotion ? 'translate-x-5.5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          {/* Readable Font */}
          <div className="flex items-start justify-between gap-4 rounded-xl border border-slate-200/80 bg-white p-4 transition dark:border-slate-800 dark:bg-slate-850">
            <div className="flex items-start gap-3.5">
              <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300">
                <PaintBrushIcon className="h-5 w-5 stroke-[2]" />
              </div>
              <div>
                <span className="text-sm font-black text-slate-900 dark:text-white">Readable Font</span>
                <p className="mt-0.5 text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
                  Provide an option to use a highly readable system font with enhanced spacing.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => updateAccSetting('readableFont', !accSettings.readableFont)}
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200 ${
                accSettings.readableFont ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'
              }`}
              title="Toggle Readable Font"
            >
              <span
                className={`inline-block h-6 w-6 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                  accSettings.readableFont ? 'translate-x-5.5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          {/* Bold Text Mode */}
          <div className="flex items-start justify-between gap-4 rounded-xl border border-slate-200/80 bg-white p-4 transition dark:border-slate-800 dark:bg-slate-850">
            <div className="flex items-start gap-3.5">
              <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300 font-black text-base">
                B
              </div>
              <div>
                <span className="text-sm font-black text-slate-900 dark:text-white">Bold Text</span>
                <p className="mt-0.5 text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
                  Increase text weight across all headings, tables, and labels for better readability.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => updateAccSetting('boldText', !accSettings.boldText)}
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200 ${
                accSettings.boldText ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'
              }`}
              title="Toggle Bold Text Mode"
            >
              <span
                className={`inline-block h-6 w-6 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                  accSettings.boldText ? 'translate-x-5.5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          {/* Focus Highlight */}
          <div className="flex items-start justify-between gap-4 rounded-xl border border-slate-200/80 bg-white p-4 transition dark:border-slate-800 dark:bg-slate-850">
            <div className="flex items-start gap-3.5">
              <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300">
                <EyeIcon className="h-5 w-5 stroke-[2]" />
              </div>
              <div>
                <span className="text-sm font-black text-slate-900 dark:text-white">Focus Highlight</span>
                <p className="mt-0.5 text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
                  Clearly indicate selected inputs, buttons, table rows, or controls when navigating.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => updateAccSetting('focusHighlight', !accSettings.focusHighlight)}
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200 ${
                accSettings.focusHighlight ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'
              }`}
              title="Toggle Focus Highlight"
            >
              <span
                className={`inline-block h-6 w-6 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                  accSettings.focusHighlight ? 'translate-x-5.5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          {/* Keyboard Navigation Helper */}
          <div className="flex items-start justify-between gap-4 rounded-xl border border-slate-200/80 bg-white p-4 transition dark:border-slate-800 dark:bg-slate-850">
            <div className="flex items-start gap-3.5">
              <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300">
                <CommandLineIcon className="h-5 w-5 stroke-[2]" />
              </div>
              <div>
                <span className="text-sm font-black text-slate-900 dark:text-white">Keyboard Navigation Helper</span>
                <p className="mt-0.5 text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
                  Ensure all functions can be accessed using Tab, Shift+Tab, Enter, Space, and Arrow keys.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => updateAccSetting('keyboardNav', !accSettings.keyboardNav)}
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200 ${
                accSettings.keyboardNav ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'
              }`}
              title="Toggle Keyboard Navigation Helper"
            >
              <span
                className={`inline-block h-6 w-6 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                  accSettings.keyboardNav ? 'translate-x-5.5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          {/* Color-Blind Friendly Mode */}
          <div className="flex items-start justify-between gap-4 rounded-xl border border-slate-200/80 bg-white p-4 transition dark:border-slate-800 dark:bg-slate-850">
            <div className="flex items-start gap-3.5">
              <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300">
                <ShieldCheckIcon className="h-5 w-5 stroke-[2]" />
              </div>
              <div>
                <span className="text-sm font-black text-slate-900 dark:text-white">Color-Blind Friendly Mode</span>
                <p className="mt-0.5 text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
                  Use icons, symbols, and labels together with colors to communicate status clearly.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => updateAccSetting('colorBlindMode', !accSettings.colorBlindMode)}
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200 ${
                accSettings.colorBlindMode ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'
              }`}
              title="Toggle Color-Blind Friendly Mode"
            >
              <span
                className={`inline-block h-6 w-6 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                  accSettings.colorBlindMode ? 'translate-x-5.5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          {/* Tooltip Assistance */}
          <div className="flex items-start justify-between gap-4 rounded-xl border border-slate-200/80 bg-white p-4 transition dark:border-slate-800 dark:bg-slate-850">
            <div className="flex items-start gap-3.5">
              <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300">
                <InformationCircleIcon className="h-5 w-5 stroke-[2]" />
              </div>
              <div>
                <span className="text-sm font-black text-slate-900 dark:text-white">Tooltip Assistance</span>
                <p className="mt-0.5 text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
                  Show helpful description popups when hovering over unfamiliar buttons or icons.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => updateAccSetting('tooltipAssistance', !accSettings.tooltipAssistance)}
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200 ${
                accSettings.tooltipAssistance ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'
              }`}
              title="Toggle Tooltip Assistance"
            >
              <span
                className={`inline-block h-6 w-6 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                  accSettings.tooltipAssistance ? 'translate-x-5.5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
        </div>
      </section>

      {/* 4. Module Management Section (Admin Only) */}
      {isAdmin ? (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="flex items-start justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Enabled
                </div>
                <div className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">{enabledCount}</div>
                <div className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">Active workspace modules</div>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-600 dark:border-emerald-900/60 dark:bg-emerald-950/60 dark:text-emerald-400">
                <PowerIcon className="h-5 w-5 stroke-[2]" />
              </div>
            </div>

            <div className="flex items-start justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Hidden
                </div>
                <div className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">{disabledCount}</div>
                <div className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">Disabled or hidden modules</div>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200/60 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                <Squares2X2Icon className="h-5 w-5 stroke-[2]" />
              </div>
            </div>

            <div className="flex items-start justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Access
                </div>
                <div className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">Admin Only</div>
                <div className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">Protected configuration</div>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-600 dark:border-emerald-900/60 dark:bg-emerald-950/60 dark:text-emerald-400">
                <ShieldCheckIcon className="h-5 w-5 stroke-[2]" />
              </div>
            </div>
          </div>

          <section className="rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-2xs dark:border-slate-800 dark:bg-slate-900 space-y-6">
            <div className="flex flex-col gap-3 border-b border-slate-100 pb-5 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-black text-slate-900 dark:text-white">System Modules</h2>
                <p className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                  Disabled modules keep their records and can be restored by switching them on again.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => updateDraft(DEFAULT_MODULE_VISIBILITY)}
                  disabled={loading || saving}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  title="Reset modules to default configuration"
                >
                  School Default
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateDraft(
                      Object.fromEntries(SYSTEM_MODULES.map((module) => [module.key, true]))
                    )
                  }
                  disabled={loading || saving}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  title="Enable all modules across workspace"
                >
                  Enable All
                </button>
              </div>
            </div>

            <div className="space-y-6">
              {Object.entries(groupedModules).map(([groupName, groupModules]) => (
                <section key={groupName} className="space-y-3">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {groupName}
                  </div>
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    {groupModules.map((module) => (
                      <ModuleToggle
                        key={module.key}
                        module={module}
                        enabled={Boolean(draftModules[module.key])}
                        disabled={LOCKED_ON_MODULES.has(module.key) || loading || saving}
                        onToggle={toggleModule}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </section>
        </>
      ) : (
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-slate-50 p-4 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
          <ShieldCheckIcon className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>
            System Module Management is reserved for Administrators. Contact your canteen manager if module configuration changes are needed.
          </span>
        </div>
      )}
    </div>
  );
}
