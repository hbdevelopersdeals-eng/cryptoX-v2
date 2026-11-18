import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
  resolveTheme, themeAttribute, readPreference, writePreference, ThemeProvider, ThemeToggle,
  useTheme, THEME_KEY
} from './theme.jsx';

const memoryStore = (initial = {}) => {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    dump: () => data
  };
};

beforeEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.style.colorScheme = '';
});

describe('theme resolution', () => {
  it('honours an explicit choice over the OS', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('follows the OS when the preference is system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('treats an unknown preference as system rather than guessing', () => {
    expect(resolveTheme('neon', false)).toBe('light');
    expect(resolveTheme(undefined, true)).toBe('dark');
  });

  it('produces the attribute the document should carry', () => {
    expect(themeAttribute('light')).toBe('light');
    expect(themeAttribute('dark')).toBe('dark');
    expect(themeAttribute('system', false)).toBe('light');
  });
});

describe('preference storage', () => {
  it('reads a valid preference and defaults to system', () => {
    expect(readPreference(memoryStore({ [THEME_KEY]: 'light' }))).toBe('light');
    expect(readPreference(memoryStore({ [THEME_KEY]: 'chartreuse' }))).toBe('system');
    expect(readPreference(memoryStore())).toBe('system');
    expect(readPreference(null)).toBe('system');
  });

  it('writes the preference', () => {
    const store = memoryStore();
    writePreference(store, 'dark');
    expect(store.dump()[THEME_KEY]).toBe('dark');
  });

  it('survives a store that throws, instead of breaking the page', () => {
    const hostile = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readPreference(hostile)).toBe('system');
    expect(() => writePreference(hostile, 'light')).not.toThrow();
  });
});

describe('one-click toggle', () => {
  it('switches the document to light and back, and persists the choice', () => {
    const store = memoryStore({ [THEME_KEY]: 'dark' });
    render(<ThemeProvider storage={store}><ThemeToggle /></ThemeProvider>);

    const button = screen.getByTestId('theme-toggle');
    // Starts dark, so the action offered is "switch to light".
    expect(button).toHaveAttribute('aria-label', 'Switch to light theme');
    expect(button).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(button);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(store.dump()[THEME_KEY]).toBe('light');
    expect(screen.getByTestId('theme-toggle')).toHaveAttribute('aria-label', 'Switch to dark theme');
    expect(screen.getByTestId('theme-toggle')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('theme-toggle'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(store.dump()[THEME_KEY]).toBe('dark');
  });

  it('restores a stored light preference on mount', () => {
    const store = memoryStore({ [THEME_KEY]: 'light' });
    render(<ThemeProvider storage={store}><ThemeToggle /></ThemeProvider>);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(screen.getByTestId('theme-toggle')).toHaveAttribute('aria-label', 'Switch to dark theme');
  });

  it('has an accessible name that states the outcome, not the current state', () => {
    const store = memoryStore({ [THEME_KEY]: 'dark' });
    render(<ThemeProvider storage={store}><ThemeToggle /></ThemeProvider>);
    const label = screen.getByTestId('theme-toggle').getAttribute('aria-label');
    expect(label).toMatch(/^Switch to (light|dark) theme$/);
  });

  it('does not throw when used outside the provider', () => {
    expect(() => render(<ThemeToggle />)).not.toThrow();
  });
});

describe('provider contract', () => {
  const Probe = () => {
    const { resolved, preference, toggle } = useTheme();
    return (
      <button type="button" onClick={toggle} data-testid="probe">
        {preference}:{resolved}
      </button>
    );
  };

  it('exposes the preference and the resolved theme separately', () => {
    render(<ThemeProvider storage={memoryStore({ [THEME_KEY]: 'system' })}><Probe /></ThemeProvider>);
    expect(screen.getByTestId('probe').textContent).toMatch(/^system:(dark|light)$/);
  });

  it('pins an explicit choice when toggled from system', () => {
    const store = memoryStore({ [THEME_KEY]: 'system' });
    render(<ThemeProvider storage={store}><Probe /></ThemeProvider>);
    fireEvent.click(screen.getByTestId('probe'));
    // A toggle that stayed on "system" could not be made to stick.
    expect(store.dump()[THEME_KEY]).toMatch(/^(light|dark)$/);
  });
});
