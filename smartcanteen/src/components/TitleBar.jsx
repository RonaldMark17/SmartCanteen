import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import BrandLogo from './BrandLogo';
import { API } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useModuleSettings } from '../contexts/useModuleSettings';
import { MODULE_KEYS, isModuleEnabled } from '../config/modules';
import {
  ArrowPathIcon,
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  BanknotesIcon,
  BuildingStorefrontIcon,
  ChartBarIcon,
  ClockIcon,
  Cog6ToothIcon,
  CubeIcon,
  DocumentChartBarIcon,
  InformationCircleIcon,
  KeyIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  MinusIcon,
  MoonIcon,
  QuestionMarkCircleIcon,
  ReceiptPercentIcon,
  ServerStackIcon,
  ShieldCheckIcon,
  SparklesIcon,
  Squares2X2Icon,
  SunIcon,
  UserGroupIcon,
  WindowIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

const isElectron =
  typeof window !== 'undefined' &&
  (window.electronAPI?.isElectron === true || window.location?.protocol === 'file:');

export default function TitleBar() {
  const [activeMenu, setActiveMenu] = useState(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [serverPing, setServerPing] = useState(null);
  const [serverStatus, setServerStatus] = useState('checking'); // 'online' | 'offline' | 'checking'
  const [aboutOpen, setAboutOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [systemInfo, setSystemInfo] = useState(null);
  const [customApiUrl, setCustomApiUrl] = useState('');
  const [configSaving, setConfigSaving] = useState(false);
  const [configSaveMsg, setConfigSaveMsg] = useState('');
  const [darkMode, setDarkMode] = useState(() => {
    try {
      return localStorage.getItem('sc_dark_mode') === '1';
    } catch {
      return false;
    }
  });

  const menuContainerRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { modules } = useModuleSettings();

  const isAuth = Boolean(user && user.role);

  // Check window maximized state from Electron
  useEffect(() => {
    if (isElectron && window.electronAPI?.isMaximized) {
      window.electronAPI.isMaximized().then((max) => setIsMaximized(Boolean(max)));
      const unsubscribe = window.electronAPI.onMaximizeChange?.((max) => {
        setIsMaximized(Boolean(max));
      });
      return () => {
        if (typeof unsubscribe === 'function') unsubscribe();
      };
    }
  }, []);

  // Sync dark mode
  useEffect(() => {
    const handleStorage = () => {
      const isDark = localStorage.getItem('sc_dark_mode') === '1';
      setDarkMode(isDark);
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('sc_dark_mode', next ? '1' : '0');
    } catch {}
  };

  // Check online status & ping backend
  const checkServerHealth = useCallback(async () => {
    const start = performance.now();
    try {
      setServerStatus('checking');
      const base = API.getBaseUrl ? API.getBaseUrl() : '';
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      
      const res = await fetch(`${base}/health`, { signal: controller.signal }).catch(() => null);
      clearTimeout(timeoutId);

      const elapsed = Math.round(performance.now() - start);
      if (res && res.ok) {
        setServerPing(elapsed);
        setServerStatus('online');
      } else {
        // Try fallback check
        setServerPing(null);
        setServerStatus(navigator.onLine ? 'online' : 'offline');
      }
    } catch {
      setServerPing(null);
      setServerStatus(navigator.onLine ? 'online' : 'offline');
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      checkServerHealth();
    };
    const handleOffline = () => {
      setIsOnline(false);
      setServerStatus('offline');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    checkServerHealth();
    const interval = setInterval(checkServerHealth, 45000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [checkServerHealth]);

  // Load system info for About dialog
  useEffect(() => {
    if (isElectron && window.electronAPI?.getSystemInfo) {
      window.electronAPI.getSystemInfo().then((info) => {
        if (info) setSystemInfo(info);
      });
    }
  }, []);

  // Close menus on outside click or escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setActiveMenu(null);
      }
    };
    const handleClickOutside = (e) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(e.target)) {
        setActiveMenu(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Menu action handlers
  const handleReload = () => {
    setActiveMenu(null);
    if (isElectron && window.electronAPI?.reload) {
      window.electronAPI.reload();
    } else {
      window.location.reload();
    }
  };

  const handleToggleDevTools = () => {
    setActiveMenu(null);
    if (isElectron && window.electronAPI?.toggleDevTools) {
      window.electronAPI.toggleDevTools();
    }
  };

  const handleToggleFullScreen = () => {
    setActiveMenu(null);
    if (isElectron && window.electronAPI?.toggleFullScreen) {
      window.electronAPI.toggleFullScreen();
    } else if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const handleZoomIn = () => {
    setActiveMenu(null);
    if (isElectron && window.electronAPI?.zoomIn) {
      window.electronAPI.zoomIn();
    }
  };

  const handleZoomOut = () => {
    setActiveMenu(null);
    if (isElectron && window.electronAPI?.zoomOut) {
      window.electronAPI.zoomOut();
    }
  };

  const handleZoomReset = () => {
    setActiveMenu(null);
    if (isElectron && window.electronAPI?.zoomReset) {
      window.electronAPI.zoomReset();
    }
  };

  const handleExitApp = () => {
    setActiveMenu(null);
    if (isElectron && window.electronAPI?.close) {
      window.electronAPI.close();
    }
  };

  const handleNav = (path) => {
    setActiveMenu(null);
    navigate(path);
  };

  const openConfigModal = async () => {
    setActiveMenu(null);
    if (isElectron && window.electronAPI?.getConfig) {
      const config = await window.electronAPI.getConfig();
      setCustomApiUrl(config?.apiBaseUrl || API.getBaseUrl());
    } else {
      setCustomApiUrl(API.getBaseUrl());
    }
    setConfigSaveMsg('');
    setConfigOpen(true);
  };

  const handleSaveConfig = async (e) => {
    e.preventDefault();
    if (!customApiUrl.trim()) return;

    setConfigSaving(true);
    setConfigSaveMsg('');

    try {
      if (isElectron && window.electronAPI?.saveConfig) {
        const res = await window.electronAPI.saveConfig({ apiBaseUrl: customApiUrl.trim() });
        if (res.success) {
          setConfigSaveMsg('Configuration saved! Please reload application.');
          if (window.MEALS_CONFIG) {
            window.MEALS_CONFIG.apiBaseUrl = customApiUrl.trim();
          }
          setTimeout(() => {
            handleReload();
          }, 1200);
        } else {
          setConfigSaveMsg(`Error: ${res.error || 'Failed to save'}`);
        }
      } else {
        localStorage.setItem('sc_custom_api_base', customApiUrl.trim());
        setConfigSaveMsg('Saved API URL. Reloading workspace...');
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      }
    } catch (err) {
      setConfigSaveMsg(`Failed to save: ${err.message}`);
    } finally {
      setConfigSaving(false);
    }
  };

  const handleClearCache = () => {
    setActiveMenu(null);
    if (window.confirm('Clear local cache and refresh? This will reset cached views and re-sync from server.')) {
      try {
        localStorage.removeItem('sc_offline_cache');
        sessionStorage.clear();
      } catch {}
      handleReload();
    }
  };

  const getPageTitle = () => {
    const p = location.pathname;
    if (p.includes('/pos')) return 'Point of Sale';
    if (p.includes('/dashboard')) return 'Dashboard';
    if (p.includes('/inventory')) return 'Inventory Management';
    if (p.includes('/transactions')) return 'Transactions';
    if (p.includes('/financial-reports')) return 'Financial Reports';
    if (p.includes('/daily-sales')) return 'Daily Sales';
    if (p.includes('/expenses')) return 'Expense Tracking';
    if (p.includes('/school-years')) return 'School Years';
    if (p.includes('/reports')) return 'Reports';
    if (p.includes('/analytics')) return 'Analytics';
    if (p.includes('/predictions')) return 'Demand Forecast';
    if (p.includes('/audit')) return 'Audit Logs';
    if (p.includes('/accounts')) return 'Account Management';
    if (p.includes('/settings')) return 'Settings';
    return 'Smart Canteen';
  };

  return (
    <>
      <header
        className="app-drag-region relative z-50 flex h-9 w-full select-none items-center justify-between border-b border-slate-800 bg-slate-950 px-2 text-xs text-slate-300 transition-colors dark:border-slate-800 dark:bg-slate-950"
        style={{ WebkitAppRegion: 'drag' }}
      >
        {/* Left: Brand + Menu Bar */}
        <div className="flex items-center gap-1.5" ref={menuContainerRef}>
          <div className="flex items-center gap-2 pl-1 pr-2">
            <BrandLogo className="h-5 w-5 drop-shadow-sm" />
            <span className="font-black tracking-tight text-white">MEALS</span>
            <span className="hidden rounded bg-emerald-950/80 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400 border border-emerald-800/40 md:inline-block">
              Client
            </span>
          </div>

          {/* Desktop App Menu Buttons */}
          <nav className="app-no-drag flex items-center gap-0.5" style={{ WebkitAppRegion: 'no-drag' }}>
            {/* File Menu */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setActiveMenu(activeMenu === 'file' ? null : 'file')}
                onMouseEnter={() => activeMenu && setActiveMenu('file')}
                className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                  activeMenu === 'file'
                    ? 'bg-slate-800 text-white font-semibold shadow-xs'
                    : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
                }`}
              >
                File
              </button>

              {activeMenu === 'file' && (
                <div className="absolute left-0 top-full mt-1 w-56 rounded-lg border border-slate-700 bg-slate-900/95 py-1.5 text-slate-200 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100">
                  <button
                    type="button"
                    onClick={handleReload}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition hover:bg-emerald-600 hover:text-white"
                  >
                    <span className="inline-flex items-center gap-2">
                      <ArrowPathIcon className="h-4 w-4 text-slate-400 group-hover:text-white" />
                      Reload Application
                    </span>
                    <span className="font-mono text-[10px] opacity-60">Ctrl+R</span>
                  </button>

                  <button
                    type="button"
                    onClick={openConfigModal}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition hover:bg-emerald-600 hover:text-white"
                  >
                    <span className="inline-flex items-center gap-2">
                      <ServerStackIcon className="h-4 w-4 text-slate-400" />
                      Server Connection...
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={handleClearCache}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition hover:bg-emerald-600 hover:text-white"
                  >
                    <span className="inline-flex items-center gap-2">
                      <ArrowPathIcon className="h-4 w-4 text-slate-400" />
                      Clear Local Cache
                    </span>
                  </button>

                  <div className="my-1 border-t border-slate-800" />

                  <button
                    type="button"
                    onClick={handleExitApp}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-rose-300 transition hover:bg-rose-600 hover:text-white"
                  >
                    <span className="inline-flex items-center gap-2">
                      <XMarkIcon className="h-4 w-4" />
                      Exit MEALS
                    </span>
                    <span className="font-mono text-[10px] opacity-60">Alt+F4</span>
                  </button>
                </div>
              )}
            </div>

            {/* View Menu */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setActiveMenu(activeMenu === 'view' ? null : 'view')}
                onMouseEnter={() => activeMenu && setActiveMenu('view')}
                className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                  activeMenu === 'view'
                    ? 'bg-slate-800 text-white font-semibold shadow-xs'
                    : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
                }`}
              >
                View
              </button>

              {activeMenu === 'view' && (
                <div className="absolute left-0 top-full mt-1 w-56 rounded-lg border border-slate-700 bg-slate-900/95 py-1.5 text-slate-200 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100">
                  <button
                    type="button"
                    onClick={handleZoomIn}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition hover:bg-emerald-600 hover:text-white"
                  >
                    <span className="inline-flex items-center gap-2">
                      <MagnifyingGlassPlusIcon className="h-4 w-4 text-slate-400" />
                      Zoom In
                    </span>
                    <span className="font-mono text-[10px] opacity-60">Ctrl +</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleZoomOut}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition hover:bg-emerald-600 hover:text-white"
                  >
                    <span className="inline-flex items-center gap-2">
                      <MagnifyingGlassMinusIcon className="h-4 w-4 text-slate-400" />
                      Zoom Out
                    </span>
                    <span className="font-mono text-[10px] opacity-60">Ctrl -</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleZoomReset}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition hover:bg-emerald-600 hover:text-white"
                  >
                    <span className="inline-flex items-center gap-2">
                      <WindowIcon className="h-4 w-4 text-slate-400" />
                      Reset Zoom
                    </span>
                    <span className="font-mono text-[10px] opacity-60">Ctrl 0</span>
                  </button>

                  <div className="my-1 border-t border-slate-800" />

                  <button
                    type="button"
                    onClick={handleToggleFullScreen}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition hover:bg-emerald-600 hover:text-white"
                  >
                    <span className="inline-flex items-center gap-2">
                      <ArrowsPointingOutIcon className="h-4 w-4 text-slate-400" />
                      Toggle Fullscreen
                    </span>
                    <span className="font-mono text-[10px] opacity-60">F11</span>
                  </button>

                  <button
                    type="button"
                    onClick={toggleDarkMode}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition hover:bg-emerald-600 hover:text-white"
                  >
                    <span className="inline-flex items-center gap-2">
                      {darkMode ? <SunIcon className="h-4 w-4 text-amber-400" /> : <MoonIcon className="h-4 w-4 text-slate-400" />}
                      {darkMode ? 'Light Theme' : 'Dark Theme'}
                    </span>
                  </button>

                  <div className="my-1 border-t border-slate-800" />

                  <button
                    type="button"
                    onClick={handleToggleDevTools}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition hover:bg-emerald-600 hover:text-white"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Cog6ToothIcon className="h-4 w-4 text-slate-400" />
                      Developer Tools
                    </span>
                    <span className="font-mono text-[10px] opacity-60">Ctrl+Shift+I</span>
                  </button>
                </div>
              )}
            </div>

            {/* Navigate Menu (when user is authenticated) */}
            {isAuth && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setActiveMenu(activeMenu === 'navigate' ? null : 'navigate')}
                  onMouseEnter={() => activeMenu && setActiveMenu('navigate')}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                    activeMenu === 'navigate'
                      ? 'bg-slate-800 text-white font-semibold shadow-xs'
                      : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
                  }`}
                >
                  Navigate
                </button>

                {activeMenu === 'navigate' && (
                  <div className="absolute left-0 top-full mt-1 w-52 rounded-lg border border-slate-700 bg-slate-900/95 py-1.5 text-slate-200 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100">
                    <button
                      type="button"
                      onClick={() => handleNav('/dashboard')}
                      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition hover:bg-emerald-600 hover:text-white"
                    >
                      <ChartBarIcon className="h-4 w-4 text-emerald-400" />
                      Dashboard
                    </button>
                    <button
                      type="button"
                      onClick={() => handleNav('/pos')}
                      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition hover:bg-emerald-600 hover:text-white"
                    >
                      <BuildingStorefrontIcon className="h-4 w-4 text-emerald-400" />
                      Point of Sale (POS)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleNav('/inventory')}
                      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition hover:bg-emerald-600 hover:text-white"
                    >
                      <CubeIcon className="h-4 w-4 text-emerald-400" />
                      Inventory
                    </button>
                    <button
                      type="button"
                      onClick={() => handleNav('/transactions')}
                      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition hover:bg-emerald-600 hover:text-white"
                    >
                      <ClockIcon className="h-4 w-4 text-emerald-400" />
                      Transactions
                    </button>
                    <button
                      type="button"
                      onClick={() => handleNav('/financial-reports')}
                      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition hover:bg-emerald-600 hover:text-white"
                    >
                      <BanknotesIcon className="h-4 w-4 text-emerald-400" />
                      Financial Reports
                    </button>
                    <button
                      type="button"
                      onClick={() => handleNav('/settings')}
                      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition hover:bg-emerald-600 hover:text-white"
                    >
                      <Cog6ToothIcon className="h-4 w-4 text-emerald-400" />
                      Settings
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Help Menu */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setActiveMenu(activeMenu === 'help' ? null : 'help')}
                onMouseEnter={() => activeMenu && setActiveMenu('help')}
                className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                  activeMenu === 'help'
                    ? 'bg-slate-800 text-white font-semibold shadow-xs'
                    : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
                }`}
              >
                Help
              </button>

              {activeMenu === 'help' && (
                <div className="absolute left-0 top-full mt-1 w-56 rounded-lg border border-slate-700 bg-slate-900/95 py-1.5 text-slate-200 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveMenu(null);
                      setAboutOpen(true);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition hover:bg-emerald-600 hover:text-white"
                  >
                    <InformationCircleIcon className="h-4 w-4 text-slate-400" />
                    About MEALS
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setActiveMenu(null);
                      setShortcutsOpen(true);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition hover:bg-emerald-600 hover:text-white"
                  >
                    <KeyIcon className="h-4 w-4 text-slate-400" />
                    Keyboard Shortcuts
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setActiveMenu(null);
                      checkServerHealth();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition hover:bg-emerald-600 hover:text-white"
                  >
                    <ServerStackIcon className="h-4 w-4 text-slate-400" />
                    Test Server Connection
                  </button>
                </div>
              )}
            </div>
          </nav>
        </div>

        {/* Center: Current Workspace Title & Status Chip */}
        <div className="hidden items-center gap-2 text-slate-400 md:flex">
          <span className="font-semibold text-slate-200">{getPageTitle()}</span>
          <span className="text-slate-600">•</span>
          <button
            type="button"
            onClick={openConfigModal}
            className="app-no-drag inline-flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900/80 px-2 py-0.5 text-[11px] font-medium transition hover:border-slate-700 hover:text-white"
            style={{ WebkitAppRegion: 'no-drag' }}
            title="Click to view or edit server connection"
          >
            <span
              className={`h-2 w-2 rounded-full ${
                serverStatus === 'online'
                  ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                  : serverStatus === 'checking'
                  ? 'bg-amber-400 animate-pulse'
                  : 'bg-rose-500'
              }`}
            />
            <span>{serverStatus === 'online' ? (serverPing ? `${serverPing}ms` : 'Connected') : serverStatus === 'checking' ? 'Connecting...' : 'Offline'}</span>
          </button>
        </div>

        {/* Right: Window Controls (Electron) or Dark mode toggle */}
        <div className="app-no-drag flex items-center" style={{ WebkitAppRegion: 'no-drag' }}>
          {isElectron ? (
            <div className="flex items-center h-9">
              {/* Minimize */}
              <button
                type="button"
                onClick={() => window.electronAPI?.minimize?.()}
                className="inline-flex h-9 w-11 items-center justify-center text-slate-400 transition hover:bg-slate-800 hover:text-white"
                aria-label="Minimize"
              >
                <MinusIcon className="h-3.5 w-3.5" />
              </button>

              {/* Maximize / Restore */}
              <button
                type="button"
                onClick={() => window.electronAPI?.maximize?.()}
                className="inline-flex h-9 w-11 items-center justify-center text-slate-400 transition hover:bg-slate-800 hover:text-white"
                aria-label={isMaximized ? 'Restore' : 'Maximize'}
              >
                {isMaximized ? (
                  <ArrowsPointingInIcon className="h-3.5 w-3.5" />
                ) : (
                  <Squares2X2Icon className="h-3.5 w-3.5" />
                )}
              </button>

              {/* Close */}
              <button
                type="button"
                onClick={() => window.electronAPI?.close?.()}
                className="inline-flex h-9 w-11 items-center justify-center text-slate-400 transition hover:bg-red-600 hover:text-white"
                aria-label="Close"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={toggleDarkMode}
              className="rounded p-1 text-slate-400 transition hover:bg-slate-800 hover:text-white"
              title="Toggle theme"
            >
              {darkMode ? <SunIcon className="h-4 w-4 text-amber-400" /> : <MoonIcon className="h-4 w-4" />}
            </button>
          )}
        </div>
      </header>

      {/* About MEALS Modal */}
      {aboutOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 text-slate-100 shadow-2xl">
            <div className="relative border-b border-slate-800 p-6 text-center">
              <button
                type="button"
                onClick={() => setAboutOpen(false)}
                className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>

              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-950/60 p-2 border border-emerald-800/40 shadow-inner">
                <BrandLogo className="h-12 w-12" />
              </div>

              <h2 className="mt-4 text-xl font-black text-white">MEALS Smart Canteen</h2>
              <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
                Desktop Client System
              </p>
            </div>

            <div className="space-y-3 p-6 text-xs text-slate-300">
              <div className="flex justify-between rounded-lg bg-slate-950/60 p-2.5 border border-slate-800">
                <span className="font-semibold text-slate-400">Application Version</span>
                <span className="font-mono font-bold text-white">1.0.0</span>
              </div>
              <div className="flex justify-between rounded-lg bg-slate-950/60 p-2.5 border border-slate-800">
                <span className="font-semibold text-slate-400">Connected Server</span>
                <span className="font-mono text-emerald-400 break-all">{systemInfo?.apiBaseUrl || API.getBaseUrl()}</span>
              </div>
              <div className="flex justify-between rounded-lg bg-slate-950/60 p-2.5 border border-slate-800">
                <span className="font-semibold text-slate-400">Server Latency</span>
                <span className="font-mono font-bold text-emerald-400">{serverPing ? `${serverPing} ms` : 'Online'}</span>
              </div>
              {systemInfo && (
                <>
                  <div className="flex justify-between rounded-lg bg-slate-950/60 p-2.5 border border-slate-800">
                    <span className="font-semibold text-slate-400">Electron Engine</span>
                    <span className="font-mono text-slate-200">v{systemInfo.electronVersion}</span>
                  </div>
                  <div className="flex justify-between rounded-lg bg-slate-950/60 p-2.5 border border-slate-800">
                    <span className="font-semibold text-slate-400">Chromium & Node</span>
                    <span className="font-mono text-slate-200">v{systemInfo.chromeVersion} / v{systemInfo.nodeVersion}</span>
                  </div>
                </>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-800 bg-slate-950/50 p-4">
              <button
                type="button"
                onClick={() => setAboutOpen(false)}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-500"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Server Connection Modal */}
      {configOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-950/60 border border-emerald-800/40 text-emerald-400">
                  <ServerStackIcon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Server Connection Settings</h3>
                  <p className="text-xs text-slate-400">Configure central database & API server endpoint</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setConfigOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveConfig} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Server API Base URL
                </label>
                <input
                  type="text"
                  value={customApiUrl}
                  onChange={(e) => setCustomApiUrl(e.target.value)}
                  placeholder="http://YOUR-SERVER-IP/api or https://your-domain.com/api"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 font-mono text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  required
                />
                <p className="mt-1.5 text-[11px] leading-4 text-slate-400">
                  Connected devices must point to the same central server API URL for real-time sales and inventory sync.
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Current Server Status:</span>
                  <span className="font-semibold text-emerald-400 inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                    {serverStatus === 'online' ? `Online (${serverPing ? `${serverPing}ms` : 'ready'})` : 'Checking...'}
                  </span>
                </div>
              </div>

              {configSaveMsg && (
                <div className={`rounded-xl border px-3.5 py-2.5 text-xs font-semibold ${
                  configSaveMsg.startsWith('Error') || configSaveMsg.startsWith('Failed')
                    ? 'border-rose-800/50 bg-rose-950/30 text-rose-300'
                    : 'border-emerald-800/50 bg-emerald-950/30 text-emerald-300'
                }`}>
                  {configSaveMsg}
                </div>
              )}

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setConfigOpen(false)}
                  className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-bold text-slate-300 hover:bg-slate-800 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={configSaving}
                  className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white shadow-md transition hover:bg-emerald-500 disabled:opacity-50"
                >
                  {configSaving ? 'Saving...' : 'Save & Reconnect'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Keyboard Shortcuts Modal */}
      {shortcutsOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-950/60 border border-emerald-800/40 text-emerald-400">
                  <KeyIcon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Keyboard Shortcuts</h3>
                  <p className="text-xs text-slate-400">Speed up your daily workflow</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShortcutsOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-2.5 text-xs">
              <div className="flex items-center justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-300">Reload Application</span>
                <kbd className="rounded border border-slate-700 bg-slate-950 px-2 py-0.5 font-mono text-[11px] text-slate-300">Ctrl + R</kbd>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-300">Toggle Fullscreen</span>
                <kbd className="rounded border border-slate-700 bg-slate-950 px-2 py-0.5 font-mono text-[11px] text-slate-300">F11</kbd>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-300">Zoom In / Zoom Out</span>
                <kbd className="rounded border border-slate-700 bg-slate-950 px-2 py-0.5 font-mono text-[11px] text-slate-300">Ctrl + / Ctrl -</kbd>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-300">Developer Tools</span>
                <kbd className="rounded border border-slate-700 bg-slate-950 px-2 py-0.5 font-mono text-[11px] text-slate-300">Ctrl + Shift + I</kbd>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-slate-300">Exit App</span>
                <kbd className="rounded border border-slate-700 bg-slate-950 px-2 py-0.5 font-mono text-[11px] text-slate-300">Alt + F4</kbd>
              </div>
            </div>

            <div className="flex justify-end border-t border-slate-800 bg-slate-950/50 p-4">
              <button
                type="button"
                onClick={() => setShortcutsOpen(false)}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-500"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
