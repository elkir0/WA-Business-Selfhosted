/**
 * Theme management — light/dark with localStorage persistence.
 *
 * Three states:
 *   'system' — follow OS (default)
 *   'light'  — force light
 *   'dark'   — force dark
 *
 * Applied by toggling `data-theme` on `<html>`, which the CSS in style.css
 * respects (see [data-theme="dark"] selector + prefers-color-scheme media).
 */

import { useEffect, useState } from 'preact/hooks';

const STORAGE_KEY = 'wa_admin_theme';

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    // localStorage unavailable
  }
  return 'system';
}

function apply(theme) {
  const root = document.documentElement;
  if (theme === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', theme);
  }
}

export function useTheme() {
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'system';
    return readStored();
  });

  useEffect(() => {
    apply(theme);
    try {
      if (theme === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // localStorage unavailable
    }
  }, [theme]);

  return [theme, setTheme];
}

// Apply the stored preference as early as possible (before React renders) to
// avoid a flash of wrong theme. Call this from main.jsx before rendering.
export function applyStoredThemeEarly() {
  if (typeof window === 'undefined') return;
  apply(readStored());
}
