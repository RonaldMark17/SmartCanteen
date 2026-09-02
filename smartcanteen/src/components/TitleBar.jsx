import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import BrandLogo from './BrandLogo';
import { API } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useModuleSettings } from '../contexts/useModuleSettings';
import { APP_ROUTE_ACCESS, isRouteEnabled } from '../config/access';
import {
  ArrowPathIcon,
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  ArrowTrendingUpIcon,
  BanknotesIcon,
  BuildingStorefrontIcon,
  CalendarDaysIcon,
  ChartBarIcon,
  ClipboardDocumentListIcon,
  ClockIcon,
  Cog6ToothIcon,
  CubeIcon,
  DocumentChartBarIcon,
  InformationCircleIcon,
  KeyIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  MinusIcon,
  ReceiptPercentIcon,
  ShieldCheckIcon,
  Squares2X2Icon,
  UserGroupIcon,
  WindowIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

const isElectron =
  typeof window !== 'undefined' &&
  (window.electronAPI?.isElectron === true || window.location?.protocol === 'file:');

export default function TitleBar() {
  const [activeMenu, setActiveMenu] = useState(null);
  const [isMaximized, setIsMaximized] = useState(true);
  const [serverPing, setServerPing] = useState(null);
  const [serverStatus, setServerStatus] = useState('checking'); // 'online' | 'offline' | 'checking'
  const [aboutOpen, setAboutOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [systemInfo, setSystemInfo] = useState(null);

  const menuContainerRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { modules } = useModuleSettings();
  const userRole = String(user?.role || '').toLowerCase();

  const isAuth = Boolean(user && user.role);

  const allNavOptions = [
    { name: 'Dashboard', path: '/dashboard', icon: ChartBarIcon },
    { name: 'POS / Cashier', path: '/pos', icon: BuildingStorefrontIcon },
    { name: 'Inventory', path: '/inventory', icon: CubeIcon },
    { name: 'Transactions', path: '/transactions', icon: ClockIcon },
    { name: 'Financial Reports', path: '/financial-reports', icon: BanknotesIcon },
    { name: 'Daily Sales', path: '/daily-sales', icon: DocumentChartBarIcon },
    { name: 'Expenses', path: '/expenses', icon: ReceiptPercentIcon },
    { name: 'School Years', path: '/school-years', icon: CalendarDaysIcon },
    { name: 'Reports', path: '/reports', icon: ClipboardDocumentListIcon },
    { name: 'Analytics', path: '/analytics', icon: ArrowTrendingUpIcon },
    { name: 'Audit Logs', path: '/audit', icon: ShieldCheckIcon },
    { name: 'User Management', path: '/accounts', icon: UserGroupIcon },
    { name: 'Settings', path: '/settings', icon: Cog6ToothIcon },
  ];

  const allowedNavItems = allNavOptions.filter((item) => {
    const route = APP_ROUTE_ACCESS.find((r) => r.path === item.path);
    return Boolean(
      route &&
        route.allowedRoles.includes(userRole) &&
        isRouteEnabled(route, modules)
    );
  });

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

  // Check online status & ping backend
  const checkServerHealth = useCallback(async () => {
    const start = performance.now();
    try {
      setServerStatus('checking');
      const res = await API.health().catch(() => null);
      const elapsed = Math.round(performance.now() - start);
      if (res) {
        setServerPing(elapsed);
        setServerStatus('online');
      } else {
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
      checkServerHealth();
    };
    const handleOffline = () => {
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
    return 'MEALS';
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
          <nav className="app-no-drag hidden sm:flex items-center gap-0.5" style={{ WebkitAppRegion: 'no-drag' }}>
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
                      <ArrowPathIcon className="h-4 w-4 text-slate-400" />
                      Reload Application
                    </span>
                    <span className="font-mono text-[10px] opacity-60">Ctrl+R</span>
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
                  <div className="absolute left-0 top-full mt-1 w-56 rounded-lg border border-slate-700 bg-slate-900/95 py-1.5 text-slate-200 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100 max-h-[75vh] overflow-y-auto custom-scrollbar">
                    {allowedNavItems.length > 0 ? (
                      allowedNavItems.map((item) => {
                        const ItemIcon = item.icon;
                        const isCurrent = location.pathname === item.path;
                        return (
                          <button
                            key={item.path}
                            type="button"
                            onClick={() => handleNav(item.path)}
                            className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition ${
                              isCurrent
                                ? 'bg-emerald-600 font-bold text-white'
                                : 'hover:bg-slate-800 hover:text-white'
                            }`}
                          >
                            <ItemIcon className={`h-4 w-4 shrink-0 ${isCurrent ? 'text-white' : 'text-emerald-400'}`} />
                            <span className="truncate">{item.name}</span>
                          </button>
                        );
                      })
                    ) : (
                      <div className="px-3 py-2 text-xs text-slate-400">No available routes</div>
                    )}
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
                </div>
              )}
            </div>
          </nav>
        </div>

        {/* Center: Draggable Spacer */}
        <div className="min-w-0 flex-1" />

        {/* Right: Window Controls (Electron) */}
        <div className="app-no-drag flex items-center" style={{ WebkitAppRegion: 'no-drag' }}>
          {isElectron && (
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
          )}
        </div>
      </header>

      {/* About MEALS Modal */}
      {aboutOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900 text-slate-100 shadow-2xl animate-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="relative border-b border-slate-800 bg-slate-950/60 p-6 text-center">
              <button
                type="button"
                onClick={() => setAboutOpen(false)}
                className="absolute right-4 top-4 rounded-xl p-2 text-slate-400 transition hover:bg-slate-800 hover:text-white"
                aria-label="Close"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>

              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-b from-emerald-500/20 to-emerald-950/60 p-2.5 border border-emerald-500/30 shadow-lg shadow-emerald-950/50">
                <BrandLogo className="h-11 w-11 drop-shadow" />
              </div>

              <h2 className="mt-3 text-xl font-black tracking-tight text-white">MEALS</h2>
              <p className="text-xs font-semibold tracking-wide text-emerald-400">
                Management of Expenses, Assets, and Logistics System
              </p>

              <div className="mt-2.5 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-950/50 px-3 py-1 text-[11px] font-bold text-emerald-300">
                <span>Version {systemInfo?.appVersion || (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.1.0')}</span>
                <span className="text-emerald-600">•</span>
                <span className="text-emerald-400/80">Desktop Edition</span>
              </div>
            </div>

            {/* Content Body */}
            <div className="max-h-[60vh] space-y-4 overflow-y-auto p-6 text-xs text-slate-300 custom-scrollbar">
              <p className="leading-relaxed text-slate-300">
                MEALS (Management of Expenses, Assets, and Logistics System) is an all-in-one operations system built for intelligent inventory tracking, canteen operations, and automated financial reporting across multiple terminals.
              </p>

              {/* Feature Highlights Grid (without POS) */}
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 pt-1">
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold">
                    <CubeIcon className="h-4 w-4 shrink-0" />
                    <span>Smart Inventory</span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400 leading-relaxed">Live stock level tracking & automated low-stock alerts.</p>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold">
                    <BanknotesIcon className="h-4 w-4 shrink-0" />
                    <span>Financial Reports</span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400 leading-relaxed">Daily sales, fund monitoring, & school year statements.</p>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold">
                    <ShieldCheckIcon className="h-4 w-4 shrink-0" />
                    <span>Security & Roles</span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400 leading-relaxed">Multi-factor auth, role segregation, & audit trails.</p>
                </div>
              </div>

              {/* System Specs */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3.5 space-y-2 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Target Platform</span>
                  <span className="font-semibold text-slate-200">Windows 10 / 11 (64-bit)</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Release Build</span>
                  <span className="font-mono text-slate-200">v{systemInfo?.appVersion || (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.1.0')} (August 2026)</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Server Synchronization</span>
                  <span className="font-semibold text-emerald-400 inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                    {serverStatus === 'online' ? `Online (${serverPing ? `${serverPing}ms` : 'synced'})` : 'Offline cache'}
                  </span>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/60 px-6 py-3.5">
              <span className="text-[11px] text-slate-500">© 2026 MEALS System</span>
              <button
                type="button"
                onClick={() => setAboutOpen(false)}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow transition hover:bg-emerald-500"
              >
                Close
              </button>
            </div>
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
