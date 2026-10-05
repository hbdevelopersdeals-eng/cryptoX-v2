import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary.jsx';
import { getErrorLog, clearErrorLog } from '../lib/telemetry.js';

function Boom() {
  throw new Error('kaboom');
}

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(<ErrorBoundary><p>all good</p></ErrorBoundary>);
    expect(screen.getByText('all good')).toBeInTheDocument();
  });

  it('catches a render error, shows a recovery UI and reports the error', () => {
    clearErrorLog();
    render(<ErrorBoundary label="test"><Boom /></ErrorBoundary>);
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
    expect(screen.getByText(/kaboom/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reload app/i })).toBeInTheDocument();

    const log = getErrorLog();
    expect(log.length).toBeGreaterThan(0);
    expect(log[log.length - 1].error.message).toBe('kaboom');
  });

  it('toggles technical details on demand', () => {
    render(<ErrorBoundary label="test"><Boom /></ErrorBoundary>);
    const details = screen.getByRole('button', { name: /Details/i });
    expect(details).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(details);
    expect(screen.getByRole('button', { name: /Hide details/i })).toHaveAttribute('aria-expanded', 'true');
  });
});
