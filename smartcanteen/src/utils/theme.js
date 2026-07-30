import { useEffect, useState } from 'react';

export function getThemeToken(name, fallback = '') {
  if (typeof window === 'undefined') {
    return fallback;
  }

  return window.getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function getThemeTokens(names) {
  return names.map((name) => getThemeToken(name));
}

export function useThemeMode() {
  const [isDark, setIsDark] = useState(() => {
    if (typeof document === 'undefined') return false;
    return document.documentElement.classList.contains('dark');
  });

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => observer.disconnect();
  }, []);

  return isDark;
}

