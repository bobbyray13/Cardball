import { useState } from 'react';
import { api } from '../api.js';
import { HouseRulesEditor } from '../components/HouseRulesEditor.js';
import { Button, EmptyState, ErrorNote, Panel, Spinner, useAction, useLoad } from '../components/ui.js';
import { useSession } from '../session.js';

export function AdminPage() {
  const invites = useLoad(() => api.invites(), []);
  const rules = useLoad(() => api.houseRules(), []);
  const { refreshRules } = useSession();
  const [days, setDays] = useState(30);
  const [fresh, setFresh] = useState<string | null>(null);

  const create = useAction(async () => {
    const { code } = await api.createInvite(days);
    setFresh(code);
    invites.reload();
  });

  const remove = useAction(async (code: string) => {
    await api.deleteInvite(code);
    invites.reload();
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-chalk">Commissioner</h1>
        <p className="mt-1 text-sm text-chalk/60">Hand out invites and set the house rules the whole league plays by.</p>
      </div>

      <Panel
        title="Invites"
        subtitle="Single-use codes. Every account after yours needs one."
        actions={
          <>
            <select className="rounded-full border border-white/20 bg-black/25 px-3 py-1.5 text-sm text-chalk" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {[7, 30, 90, 365].map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
            <Button variant="primary" onClick={() => void create.execute()} disabled={create.busy}>
              {create.busy ? 'Minting…' : 'New invite'}
            </Button>
          </>
        }
      >
        {fresh ? (
          <div className="mb-3 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-gold">
            New code: <code className="font-mono font-bold">{fresh}</code> — send it to your friend.
          </div>
        ) : null}
        <ErrorNote error={create.error ?? remove.error ?? invites.error} />

        {invites.loading && !invites.data ? (
          <Spinner />
        ) : (invites.data?.invites.length ?? 0) === 0 ? (
          <EmptyState title="No invites yet">Mint one to bring a friend into the league.</EmptyState>
        ) : (
          <ul className="divide-y divide-white/10">
            {invites.data!.invites.map((invite) => {
              const expired = invite.expiresAt !== null && new Date(invite.expiresAt) < new Date();
              return (
                <li key={invite.code} className="flex flex-wrap items-center gap-3 py-2.5">
                  <code className="font-mono text-sm text-chalk">{invite.code}</code>
                  <span className={`text-xs ${invite.usedBy ? 'text-gold' : expired ? 'text-crimson' : 'text-chalk/50'}`}>
                    {invite.usedBy ? `used by ${invite.usedBy}` : expired ? 'expired' : 'unused'}
                  </span>
                  <span className="font-mono text-xs text-chalk/35">
                    {invite.expiresAt ? `expires ${new Date(invite.expiresAt).toLocaleDateString()}` : 'no expiry'}
                  </span>
                  {!invite.usedBy ? (
                    <Button size="sm" variant="danger" className="ml-auto" onClick={() => void remove.execute(invite.code)} disabled={remove.busy}>
                      Revoke
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <ErrorNote error={rules.error} />
      {rules.loading && !rules.data ? (
        <Spinner label="Reading the rulebook…" />
      ) : rules.data ? (
        <HouseRulesEditor
          initial={rules.data.rules}
          onSaved={(saved) => {
            rules.setData({ rules: saved });
            void refreshRules();
          }}
        />
      ) : null}
    </div>
  );
}
