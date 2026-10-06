import { useState } from 'react';
import { Button, ErrorNote, Field, Panel, inputClass } from '../components/ui.js';
import { useSession } from '../session.js';

export function LoginPage() {
  const { needsSetup, signIn, register } = useSession();
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const firstRun = needsSetup;
  const showCreate = firstRun || creating;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (showCreate) {
        await register({ email, password, displayName, ...(inviteCode ? { inviteCode } : {}) });
      } else {
        await signIn(email, password);
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="font-display text-4xl font-bold text-chalk">
            Baseball <span className="text-gold">Cardball</span>
          </h1>
          <p className="mt-2 text-sm text-chalk/60">
            The tabletop dice game, played with your real baseball cards — online, with friends.
          </p>
        </div>

        <Panel
          title={showCreate ? (firstRun ? 'Set up the league' : 'Create your account') : 'Sign in'}
          subtitle={
            firstRun
              ? 'The first account becomes the commissioner and can hand out invites.'
              : showCreate
                ? 'You need an invite code from the commissioner.'
                : undefined
          }
        >
          <form className="space-y-3" onSubmit={submit}>
            {showCreate ? (
              <Field label="Display name">
                <input name="displayName" className={inputClass} value={displayName} onChange={(e) => setDisplayName(e.target.value)} required minLength={2} maxLength={40} autoComplete="nickname" />
              </Field>
            ) : null}

            <Field label="Email">
              <input name="email" className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </Field>

            <Field label="Password" hint={showCreate ? 'At least 8 characters.' : undefined}>
              <input
                name="password"
                className={inputClass}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={showCreate ? 8 : undefined}
                autoComplete={showCreate ? 'new-password' : 'current-password'}
              />
            </Field>

            {showCreate && !firstRun ? (
              <Field label="Invite code">
                <input name="inviteCode" className={`${inputClass} font-mono`} value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} required />
              </Field>
            ) : null}

            <ErrorNote error={error} />

            <Button type="submit" variant="primary" className="w-full" disabled={busy}>
              {busy ? 'Working…' : showCreate ? 'Create account' : 'Sign in'}
            </Button>
          </form>

          {!firstRun ? (
            <button
              type="button"
              className="mt-4 w-full text-center text-sm text-chalk/55 underline-offset-2 hover:text-chalk hover:underline"
              onClick={() => {
                setCreating((c) => !c);
                setError(null);
              }}
            >
              {showCreate ? 'I already have an account' : 'I have an invite code'}
            </button>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}
