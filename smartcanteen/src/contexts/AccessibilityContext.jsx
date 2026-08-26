import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAuth } from './AuthContext';

export const DEFAULT_ACCESSIBILITY_SETTINGS = {
  interfaceScale: '100', // '100' | '110' | '125' | '150'
  textSize: 'default',   // 'default' | 'large' | 'xlarge'
  highContrast: false,
  reduceMotion: false,
  readableFont: false,
  boldText: false,
  focusHighlight: false,
  keyboardNav: true,
  colorBlindMode: false,
  tooltipAssistance: true,
};

const AccessibilityContext = createContext({
  settings: DEFAULT_ACCESSIBILITY_SETTINGS,
  updateSetting: () => {},
  resetSettings: () => {},
});

function getStorageKey(user) {
  const identifier = user?.id || user?.username || 'default';
  return `sc_accessibility_desktop_${identifier}`;
}

export function AccessibilityProvider({ children }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState(() => DEFAULT_ACCESSIBILITY_SETTINGS);

  // Load user-specific desktop accessibility settings when active user changes
  useEffect(() => {
    if (!user) {
      setSettings(DEFAULT_ACCESSIBILITY_SETTINGS);
      return;
    }
    const key = getStorageKey(user);
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        setSettings({ ...DEFAULT_ACCESSIBILITY_SETTINGS, ...JSON.parse(stored) });
      } else {
        setSettings(DEFAULT_ACCESSIBILITY_SETTINGS);
      }
    } catch {
      setSettings(DEFAULT_ACCESSIBILITY_SETTINGS);
    }
  }, [user]);

  // Apply CSS root classes dynamically to documentElement
  useEffect(() => {
    const root = document.documentElement;

    // 1. Interface Scale (Desktop Layout Zoom)
    root.classList.remove('acc-scale-100', 'acc-scale-110', 'acc-scale-125', 'acc-scale-150');
    if (settings.interfaceScale && settings.interfaceScale !== '100') {
      root.classList.add(`acc-scale-${settings.interfaceScale}`);
    }

    // 2. Text Size
    root.classList.remove('acc-text-default', 'acc-text-large', 'acc-text-xlarge');
    if (settings.textSize && settings.textSize !== 'default') {
      root.classList.add(`acc-text-${settings.textSize}`);
    }

    // 3. Desktop Feature Toggles
    root.classList.toggle('acc-high-contrast', Boolean(settings.highContrast));
    root.classList.toggle('acc-reduce-motion', Boolean(settings.reduceMotion));
    root.classList.toggle('acc-readable-font', Boolean(settings.readableFont));
    root.classList.toggle('acc-bold-text', Boolean(settings.boldText));
    root.classList.toggle('acc-focus-highlight', Boolean(settings.focusHighlight));
    root.classList.toggle('acc-keyboard-nav', Boolean(settings.keyboardNav));
    root.classList.toggle('acc-color-blind', Boolean(settings.colorBlindMode));
    root.classList.toggle('acc-tooltip-assistance', Boolean(settings.tooltipAssistance));
  }, [settings]);

  const updateSetting = useCallback(
    (key, value) => {
      setSettings((prev) => {
        const next = { ...prev, [key]: value };
        if (user) {
          try {
            localStorage.setItem(getStorageKey(user), JSON.stringify(next));
          } catch {
            // Ignore quota errors
          }
        }
        return next;
      });
    },
    [user]
  );

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_ACCESSIBILITY_SETTINGS);
    if (user) {
      try {
        localStorage.removeItem(getStorageKey(user));
      } catch {}
    }
  }, [user]);

  return (
    <AccessibilityContext.Provider value={{ settings, updateSetting, resetSettings }}>
      {children}
    </AccessibilityContext.Provider>
  );
}

export function useAccessibility() {
  return useContext(AccessibilityContext);
}
