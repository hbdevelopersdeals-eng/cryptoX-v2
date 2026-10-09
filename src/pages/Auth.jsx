import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { LogIn, UserPlus, Mail, KeyRound, Eye, EyeOff, Loader2, Lock, MailCheck } from 'lucide-react';
import { useAuth, validateEmail, validatePassword } from '../lib/auth.jsx';

/* Auth screens. Two delivery modes behind one UI:
 *  - supabase: real accounts, confirmation by email link.
 *  - demo:     local-only accounts with an in-app "demo inbox" code. */

export function GoogleG({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.57 5.57 0 0 1-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A11.99 11.99 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.27 14.29A7.16 7.16 0 0 1 4.89 12c0-.8.14-1.57.38-2.29V6.62H1.29a11.99 11.99 0 0 0 0 10.76l3.98-3.09z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
    </svg>
  );
}

function AuthFrame({ icon, title, sub, children }) {
  const { mode } = useAuth();
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-10 text-center">
          <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
            {React.cloneElement(icon, { size: 28, strokeWidth: 2.2 })}
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          {sub ? <p className="mt-2 text-base text-muted-foreground">{sub}</p> : null}
        </div>
        {children}
        <p className="mt-6 text-center text-xs text-muted-foreground/70">
          {mode === 'supabase'
            ? 'Accounts are stored securely on our servers. No real trading — research and simulation only.'
            : 'Demo build — accounts and data stay in your browser. No real trading.'}
        </p>
      </div>
    </div>
  );
}

function AuthCard({ children }) {
  return <div className="card-panel p-8">{children}</div>;
}

function LabeledInput({ label, icon, right, id, ...props }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-sm font-medium leading-none">{label}</label>
        {right}
      </div>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
          {icon}
        </span>
        <input id={id} className="input-dark pl-10" {...props} />
      </div>
    </div>
  );
}

function FieldError({ msg }) {
  return msg ? <p role="alert" className="text-xs font-medium text-destructive">{msg}</p> : null;
}

function GoogleButton({ onClick }) {
  const { mode } = useAuth();
  if (mode === 'supabase') return null; // no OAuth provider configured for this deployment
  return (
    <>
      <button type="button" className="btn-ghost mb-2 w-full" onClick={onClick}>
        <GoogleG /> Continue with Google (demo)
      </button>
      <p className="mb-6 text-center text-[11px] text-muted-foreground/80">Demo shortcut — no real Google OAuth is configured.</p>
    </>
  );
}

function OrDivider() {
  return (
    <div className="relative mb-6">
      <div className="absolute inset-x-0 top-1/2 border-t border-border" />
      <div className="relative flex justify-center">
        <span className="bg-card px-3 text-xs uppercase text-muted-foreground">or</span>
      </div>
    </div>
  );
}

/* Demo delivery channel: no email service in demo mode, so the code is shown
   in-app and clearly labelled. Never rendered in Supabase mode. */
function DemoInbox({ inbox, onResend }) {
  const { mode } = useAuth();
  if (mode === 'supabase' || !inbox) return null;
  return (
    <div className="mb-4 rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs">
      <p className="font-semibold text-primary">Demo inbox — no email is actually sent</p>
      <p className="mt-1 text-muted-foreground">
        Verification code for <b className="text-foreground">{inbox.email}</b>
      </p>
      <p className="num mt-1 text-lg font-bold tracking-[0.3em] text-foreground">{inbox.code}</p>
      <p className="mt-1 text-muted-foreground">
        Expires in 10 minutes.
        {onResend ? (
          <>
            {' '}
            <button type="button" onClick={onResend} className="font-medium text-primary hover:underline">Resend code</button>
          </>
        ) : null}
      </p>
    </div>
  );
}

function VerifyForm({ email, onVerified, onResend }) {
  const { verifyEmail, inbox } = useAuth();
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (code.trim().length !== 6) return setErr('Enter the 6-digit code');
    setLoading(true);
    const res = await verifyEmail(email, code);
    setLoading(false);
    if (!res.ok) return setErr(res.error);
    onVerified();
  };

  return (
    <>
      <DemoInbox inbox={inbox} onResend={onResend} />
      <form onSubmit={submit} className="space-y-4">
        <LabeledInput
          id="code"
          label="Verification code"
          icon={<KeyRound size={16} />}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        />
        <FieldError msg={err} />
        <button className="btn-primary w-full" disabled={loading}>
          {loading ? <><Loader2 size={16} className="animate-spin" /> Verifying...</> : 'Verify & continue'}
        </button>
      </form>
    </>
  );
}

/* Shown after sign-up in Supabase mode: confirmation arrives by email. */
function CheckEmailPanel({ email, onResend, onBack }) {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
        <p className="font-semibold text-primary">Check your email</p>
        <p className="mt-1 text-muted-foreground">
          We sent a confirmation link to <b className="text-foreground">{email}</b>. Open it to activate your account,
          then log in.
        </p>
      </div>
      {sent ? <p role="status" className="text-xs text-muted-foreground">If that address is registered, a new link is on its way.</p> : null}
      <button
        type="button"
        className="btn-ghost w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await onResend();
          setBusy(false);
          setSent(true);
        }}
      >
        {busy ? <><Loader2 size={16} className="animate-spin" /> Sending...</> : 'Resend confirmation email'}
      </button>
      <Link to="/login" className="btn-primary w-full">Go to log in</Link>
      {onBack ? (
        <button type="button" className="w-full text-center text-xs text-muted-foreground hover:text-foreground" onClick={onBack}>
          Use a different email
        </button>
      ) : null}
    </div>
  );
}

/* ---------- LOGIN ---------- */
export function LoginPage() {
  const { login, oauthLogin, resendCode, mode } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    const ev = validateEmail(email);
    if (!ev.ok) return setErr(ev.error);
    setLoading(true);
    const res = await login(email, password);
    setLoading(false);
    if (!res.ok) {
      if (res.needVerify && mode === 'supabase') return setUnconfirmed(true);
      return setErr(res.error);
    }
    if (res.needVerify) return setVerifying(true);
    nav('/');
  };

  if (unconfirmed) {
    return (
      <AuthFrame icon={<MailCheck />} title="Confirm your email" sub="One more step before you can sign in">
        <AuthCard>
          <CheckEmailPanel email={email} onResend={() => resendCode(email)} onBack={() => setUnconfirmed(false)} />
        </AuthCard>
      </AuthFrame>
    );
  }

  if (verifying) {
    return (
      <AuthFrame icon={<Mail />} title="Verify your email" sub="Enter the code to finish signing in">
        <AuthCard>
          <VerifyForm email={email} onVerified={() => nav('/')} onResend={() => resendCode(email)} />
        </AuthCard>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame icon={<LogIn />} title="Welcome back" sub="Log in to your account">
      <AuthCard>
        <GoogleButton onClick={() => oauthLogin()} />
        {mode === 'demo' ? <OrDivider /> : null}
        <form onSubmit={submit} className="space-y-4">
          <LabeledInput id="email" label="Email" icon={<Mail size={16} />} type="email" placeholder="you@example.com" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <div className="space-y-2">
            <LabeledInput
              id="password"
              label="Password"
              icon={<Lock size={16} />}
              right={
                <Link to="/forgot-password" className="text-xs text-primary hover:underline">Forgot password?</Link>
              }
              type={show ? 'text' : 'password'}
              placeholder="••••••••"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShow(!show)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {show ? <EyeOff size={13} /> : <Eye size={13} />} {show ? 'Hide' : 'Show'}
            </button>
          </div>
          <FieldError msg={err} />
          <button className="btn-primary w-full" disabled={loading}>
            {loading ? <><Loader2 size={16} className="animate-spin" /> Logging in...</> : 'Log in'}
          </button>
        </form>
      </AuthCard>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Don't have an account?{' '}
        <Link to="/register" className="font-medium text-primary hover:underline">Create one</Link>
      </p>
    </AuthFrame>
  );
}

/* ---------- REGISTER ---------- */
export function RegisterPage() {
  const { register, resendCode, mode } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [step, setStep] = useState('form');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    const ev = validateEmail(email);
    if (!ev.ok) return setErr(ev.error);
    const pv = validatePassword(password);
    if (!pv.ok) return setErr(pv.error);
    if (password !== confirm) return setErr('Passwords do not match');
    setLoading(true);
    const res = await register(email, password);
    setLoading(false);
    if (!res.ok) return setErr(res.error);
    if (res.needVerify && mode === 'supabase') return setStep('checkEmail');
    if (res.needVerify) return setStep('verify');
    nav('/');
  };

  if (step === 'checkEmail') {
    return (
      <AuthFrame icon={<MailCheck />} title="Check your email" sub="Confirmation link sent">
        <AuthCard>
          <CheckEmailPanel email={email} onResend={() => resendCode(email)} onBack={() => setStep('form')} />
        </AuthCard>
      </AuthFrame>
    );
  }

  if (step === 'verify') {
    return (
      <AuthFrame icon={<Mail />} title="Verify your email" sub="Enter the 6-digit code we issued for your account">
        <AuthCard>
          <VerifyForm email={email} onVerified={() => nav('/')} onResend={() => resendCode(email)} />
        </AuthCard>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame icon={<UserPlus />} title="Create your account" sub="Sign up to get started">
      <AuthCard>
        <GoogleButton onClick={() => nav('/')} />
        {mode === 'supabase' ? null : <OrDivider />}
        <form onSubmit={submit} className="space-y-4">
          <LabeledInput id="email" label="Email" icon={<Mail size={16} />} type="email" placeholder="you@example.com" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <LabeledInput id="password" label="Password" icon={<Lock size={16} />} type="password" placeholder="••••••••" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <LabeledInput id="confirm" label="Confirm Password" icon={<Lock size={16} />} type="password" placeholder="••••••••" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <p className="text-[11px] text-muted-foreground">
            At least 8 characters, including a letter and a number.{' '}
            {mode === 'supabase'
              ? 'Your password is stored hashed by our authentication service.'
              : 'Stored as a salted PBKDF2 hash in this browser.'}
          </p>
          <FieldError msg={err} />
          <button className="btn-primary w-full" disabled={loading}>
            {loading ? <><Loader2 size={16} className="animate-spin" /> Creating account...</> : 'Create account'}
          </button>
        </form>
      </AuthCard>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-primary hover:underline">Log in</Link>
      </p>
    </AuthFrame>
  );
}

/* ---------- FORGOT PASSWORD ---------- */
export function ForgotPage() {
  const { resetPassword, mode } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    const ev = validateEmail(email);
    if (!ev.ok) return setErr(ev.error);
    setLoading(true);
    await resetPassword(email);
    setLoading(false);
    setSent(true);
  };

  return (
    <AuthFrame icon={<Mail />} title="Reset password" sub="We'll send you a link to reset it">
      <AuthCard>
        {sent ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            If an account exists with that email, a password reset link is on its way.
            {mode === 'demo' ? ' (Demo mode: no email is actually sent.)' : ' Check your inbox and spam folder.'}
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <LabeledInput id="email" label="Email address" icon={<Mail size={16} />} type="email" placeholder="you@example.com" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <FieldError msg={err} />
            <button className="btn-primary w-full" disabled={loading}>
              {loading ? <><Loader2 size={16} className="animate-spin" /> Sending...</> : 'Send reset link'}
            </button>
          </form>
        )}
      </AuthCard>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link to="/login" className="font-medium text-primary hover:underline">← Back to log in</Link>
      </p>
    </AuthFrame>
  );
}

/* ---------- RESET PASSWORD ---------- */
export function ResetPage() {
  const nav = useNavigate();
  const { updatePassword, mode, session } = useAuth();
  const [params] = useSearchParams();
  // Demo mode carries ?code&email; Supabase mode relies on the recovery session
  // created by the emailed link, so there is nothing to validate in the URL.
  const invalid = mode === 'demo' && (!params.get('code') || !params.get('email'));
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  if (invalid) {
    return (
      <AuthFrame icon={<KeyRound />} title="Invalid reset link" sub="This password reset link is missing or invalid">
        <div className="card-panel p-8">
          <p className="text-sm text-foreground">
            The link you used appears to be incomplete. Please request a new password reset email.
          </p>
          <Link to="/forgot-password" className="btn-ghost mt-6 w-full">Request a new link</Link>
        </div>
      </AuthFrame>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    const pv = validatePassword(pw);
    if (!pv.ok) return setErr(pv.error);
    if (pw !== pw2) return setErr('Passwords do not match');
    setLoading(true);
    if (mode === 'supabase') {
      const res = await updatePassword(pw);
      setLoading(false);
      if (!res.ok) return setErr(res.error || 'Could not update the password');
      nav('/');
      return;
    }
    setTimeout(() => nav('/login'), 400);
  };

  return (
    <AuthFrame icon={<KeyRound />} title="New password" sub="Enter your new password below">
      <AuthCard>
        {mode === 'supabase' && !session ? (
          <p className="mb-4 text-sm text-muted-foreground">
            Open this page from the reset link in your email so we can verify it is really you.
          </p>
        ) : null}
        <form onSubmit={submit} className="space-y-4">
          <LabeledInput id="pw" label="New Password" icon={<Lock size={16} />} type="password" placeholder="••••••••" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <LabeledInput id="pw2" label="Confirm Password" icon={<Lock size={16} />} type="password" placeholder="••••••••" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          <FieldError msg={err} />
          <button className="btn-primary w-full" disabled={loading}>
            {loading ? <><Loader2 size={16} className="animate-spin" /> Updating...</> : 'Update password'}
          </button>
        </form>
      </AuthCard>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link to="/login" className="font-medium text-primary hover:underline">← Back to log in</Link>
      </p>
    </AuthFrame>
  );
}
