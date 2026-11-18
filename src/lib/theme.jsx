import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

/* Light and dark themes, one click apart.
 *
 * The palette lives in CSS variables (src/styles.css) and Tailwind maps its colour
 * names onto them, so switching `data-theme` on <html> repaints the entire app
 * without a single component knowing a theme exists. Components keep using
 * `bg-card`, `text-foreground`, `border-border`.
 *
 * THREE STATES, ONE BUTTON
 * A stored preference of 'system' is what a first-time visitor gets, and it follows
 * the OS. The button shows what will happen next: a moon while you are in light
 * mode, a sun while you are in dark. Pressing it pins an explicit choice, because a
 * toggle that silently keeps following the OS is a toggle the user cannot make
 * stick. Clearing the preference returns to 'system'.
 *
 * NO FLASH
 * An inline script in index.html sets the attribute before the first paint. Without
 * it, a dark-preferring user sees a white flash on every load — the most common way
 * theming is shipped badly.
 */

export const THEME_KEY = 'cx_theme';
export const THEMES = ['dark', 'light', 'system'];

/** Resolve a stored preference against the OS setting. */
export function resolveTheme(preference, prefersDark = false) {
  if (preference === 'light' || preference === 'dark') return preference;
  return prefersDark ? 'dark' : 'light';
}

export function readPreference(storage) {
  try {
    const raw = storage?.getItem?.(THEME_KEY);
    return THEMES.includes(raw) ? raw : 'system';
  } catch {
    return 'system';
  }
}

export function writePreference(storage, preference) {
  try {
    storage?.setItem?.(THEME_KEY, preference);
  } catch {
    /* Private mode or a blocked store: the session still switches, it just will
       not be remembered. Failing loudly here would break the page over a nicety. */
  }
}

/** The attribute value the document should carry. */
export function themeAttribute(preference, prefersDark = false) {
  return resolveTheme(preference, prefersDark) === 'light' ? 'light' : 'dark';
}

const ThemeContext = createContext(null);

export function ThemeProvider({ children, storage = typeof window !== 'undefined' ? window.localStorage : null }) {
  const [preference, setPreference] = useState(() => readPreference(storage));
  const [systemDark, setSystemDark] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return true;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  /* Follow the OS while the preference is 'system'. The listener is registered
     regardless, so switching back to 'system' takes effect immediately. */
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => setSystemDark(e.matches);
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener?.(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener?.(onChange);
    };
  }, []);

  const resolved = resolveTheme(preference, systemDark);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', resolved);
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);

  const setTheme = useCallback((next) => {
    if (!THEMES.includes(next)) return;
    setPreference(next);
    writePreference(storage, next);
  }, [storage]);

  /** One click: pin the opposite of what is on screen right now. */
  const toggle = useCallback(() => {
    setTheme(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved, setTheme]);

  const value = useMemo(
    () => ({ preference, resolved, isDark: resolved === 'dark', setTheme, toggle }),
    [preference, resolved, setTheme, toggle]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  /* Not throwing here is deliberate: a component rendered outside the provider
     (a test, a story, an isolated preview) should still work, just without the
     ability to switch. */
  return ctx || { preference: 'system', resolved: 'dark', isDark: true, setTheme: () => {}, toggle: () => {} };
}

/**
 * The button. Icon-only, so it needs an accessible name that states the outcome,
 * not the current state: "Switch to light theme" is actionable; "Light" is a riddle.
 */
export function ThemeToggle({ className = '' }) {
  const { isDark, toggle } = useTheme();
  const label = isDark ? 'Switch to light theme' : 'Switch to dark theme';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      aria-pressed={!isDark}
      data-testid="theme-toggle"
      className={
        'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-foreground ' +
        'transition-colors hover:bg-accent focus-visible:outline focus-visible:outline-2 ' +
        className
      }
    >
      {isDark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
    </button>
  );
}

export default ThemeProvider;
