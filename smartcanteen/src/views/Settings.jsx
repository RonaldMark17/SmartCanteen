import { useEffect, useMemo, useState } from 'react';
import {
  ArrowPathIcon,
  CheckCircleIcon,
  Cog6ToothIcon,
  PowerIcon,
  ShieldCheckIcon,
  Squares2X2Icon,
} from '@heroicons/react/24/outline';
import DismissibleAlert from '../components/DismissibleAlert';
import { useModuleSettings } from '../contexts/useModuleSettings';
import {
  DEFAULT_MODULE_VISIBILITY,
  MODULE_KEYS,
  SYSTEM_MODULES,
  normalizeModuleSettings,
} from '../config/modules';

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

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('sc_user') || '{}');
  } catch {
    return {};
  }
}

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
      className={`flex w-full items-center justify-between gap-4 rounded-lg border px-4 py-4 text-left transition sm:px-5 ${
        enabled
          ? 'border-primary/30 bg-primary/5 ring-1 ring-primary/10'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
      } ${disabled ? 'cursor-not-allowed opacity-80' : ''}`}
    >
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-base font-black text-slate-950">{module.label}</span>
          {disabled ? (
            <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-slate-500">
              Required
            </span>
          ) : null}
        </span>
        <span className="mt-1 block text-sm leading-6 text-slate-500">
          {MODULE_DESCRIPTIONS[module.key] || 'Workspace module'}
        </span>
      </span>

      <span
        className={`relative flex h-8 w-14 shrink-0 items-center rounded-full p-1 transition ${
          enabled ? 'bg-primary' : 'bg-slate-300'
        }`}
      >
        <span
          className={`h-6 w-6 rounded-full bg-white shadow-sm transition ${
            enabled ? 'translate-x-6' : 'translate-x-0'
          }`}
        />
      </span>
    </button>
  );
}

export default function Settings() {
  const user = getStoredUser();
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

  useEffect(() => {
    setDraftModules(normalizeModuleSettings(modules));
  }, [modules]);

  const groupedModules = useMemo(() => groupModules(SYSTEM_MODULES), []);
  const enabledCount = SYSTEM_MODULES.filter((module) => draftModules[module.key]).length;
  const disabledCount = SYSTEM_MODULES.length - enabledCount;
  const dirty = !areModuleSettingsEqual(draftModules, modules);

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

  if (user.role !== 'admin') {
    return (
      <div className="view-shell">
        <div className="panel-card flex min-h-[320px] flex-col justify-center">
          <div className="max-w-2xl">
            <div className="text-sm font-black uppercase tracking-widest text-primary">
              Administrator only
            </div>
            <h1 className="mt-3 text-2xl font-black text-slate-950">
              Module Management is only available to Administrators.
            </h1>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="view-shell custom-scrollbar">
      <div className="view-header">
        <div>
          <div className="view-eyebrow">
            <Cog6ToothIcon className="h-4 w-4" />
            Settings
          </div>
          <h1 className="view-title mt-3">Module Management</h1>
          <p className="view-subtitle">
            Choose which MEALS modules appear in navigation, dashboard tools, and reminders.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading || refreshing || saving}
            className="action-button"
          >
            <ArrowPathIcon className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || loading || saving}
            className="primary-action-button min-w-32"
          >
            <CheckCircleIcon className="h-5 w-5" />
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {(error || saveError) && (
        <DismissibleAlert resetKey={`${error}-${saveError}`} tone="amber" className="rounded-xl">
          {saveError || error}
        </DismissibleAlert>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="panel-card flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-black uppercase tracking-widest text-slate-500">
              Enabled
            </div>
            <div className="mt-2 text-3xl font-black text-slate-950">{enabledCount}</div>
          </div>
          <div className="rounded-lg bg-emerald-50 p-3 text-emerald-600">
            <PowerIcon className="h-6 w-6" />
          </div>
        </div>

        <div className="panel-card flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-black uppercase tracking-widest text-slate-500">
              Hidden
            </div>
            <div className="mt-2 text-3xl font-black text-slate-950">{disabledCount}</div>
          </div>
          <div className="rounded-lg bg-slate-100 p-3 text-slate-500">
            <Squares2X2Icon className="h-6 w-6" />
          </div>
        </div>

        <div className="panel-card flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-black uppercase tracking-widest text-slate-500">
              Access
            </div>
            <div className="mt-2 text-lg font-black text-slate-950">Admin controlled</div>
          </div>
          <div className="rounded-lg bg-primary/10 p-3 text-primary">
            <ShieldCheckIcon className="h-6 w-6" />
          </div>
        </div>
      </div>

      <div className="panel-card">
        <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-950">System Modules</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Disabled modules keep their records and can be restored by switching them on again.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => updateDraft(DEFAULT_MODULE_VISIBILITY)}
              disabled={loading || saving}
              className="action-button"
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
              className="action-button"
            >
              Enable All
            </button>
          </div>
        </div>

        <div className="mt-5 space-y-6">
          {Object.entries(groupedModules).map(([groupName, groupModules]) => (
            <section key={groupName}>
              <div className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-slate-500">
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
      </div>
    </div>
  );
}
