import { useState } from 'react';
import { RBI_BONUS_BANDS, RULES_CONFIG, RUNNER_ADVANTAGE, SB_BANDS, HIT_BANDS, PIT_BANDS } from '@cardball/shared';
import { api } from '../api.js';
import { Button, EmptyState, ErrorNote, Panel, Spinner, useAction, useLoad } from '../components/ui.js';

export function AdminPage() {
  const invites = useLoad(() => api.invites(), []);
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
        <p className="mt-1 text-sm text-chalk/60">Hand out invites and review the house rules in force.</p>
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

      <Panel title="House rules" subtitle="These live in packages/shared/src/config.ts — the tunables that were not printed on the ball card.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <RuleTable
            title="HIT — from AVG"
            rows={HIT_BANDS.map((b, i, all) => [
              i === all.length - 1 ? `< .220` : `≥ ${b.min.toFixed(3).replace(/^0/, '')}`,
              fmtMod(b.mod),
            ])}
          />
          <RuleTable
            title="PIT — from ERA"
            rows={PIT_BANDS.map((b, i, all) => [i === all.length - 1 ? `> 4.50` : `≤ ${b.max.toFixed(2)}`, fmtMod(b.mod)])}
          />
          <RuleTable
            title="SB — from steals"
            rows={SB_BANDS.map((b, i, all) => [i === all.length - 1 ? '< 5' : `≥ ${b.min}`, fmtMod(b.mod)])}
          />
          <RuleTable
            title="Innings caps"
            rows={[
              ['Starter', `${RULES_CONFIG.ipCaps.starter} IP`],
              ['Reliever', `${RULES_CONFIG.ipCaps.reliever} IP`],
              ['Closer', `${RULES_CONFIG.ipCaps.closer} IP`],
              ['Reliever-only innings', RULES_CONFIG.relieverOnlyInnings.join(', ')],
            ]}
          />
          <RuleTable
            title="Dice and limits"
            rows={[
              ['Walk after', `${RULES_CONFIG.walkBalls} tied rolls`],
              ['Double play target', `> ${RULES_CONFIG.dpTarget}`],
              ['Stat window', `${RULES_CONFIG.statWindowSeasons} seasons`],
              ['Position eligibility', `${RULES_CONFIG.positionEligibilityGames} games`],
              ['Send re-rolls 1s', RULES_CONFIG.sendRerollOnes ? 'yes' : 'no'],
            ]}
          />
          <RuleTable
            title="Defaults we chose"
            rows={[
              ['RBI bonus', RBI_BONUS_BANDS.map((b) => `≥${b.min} → ${fmtMod(b.mod)}`).join(', ')],
              ['Red rolls', RUNNER_ADVANTAGE.red.join(', ')],
              ['Blue rolls', RUNNER_ADVANTAGE.blue.join(', ')],
            ]}
          />
        </div>
      </Panel>
    </div>
  );
}

const fmtMod = (mod: number) => (mod > 0 ? `+${mod}` : String(mod));

function RuleTable({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
      <h3 className="mb-2 font-display text-sm font-semibold text-chalk">{title}</h3>
      <table className="w-full font-mono text-xs">
        <tbody>
          {rows.map(([label, value], i) => (
            <tr key={i} className="border-t border-white/5 first:border-0">
              <td className="py-1 text-chalk/60">{label}</td>
              <td className="py-1 text-right text-chalk">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
