import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Button, EmptyState, ErrorNote, Field, Panel, Spinner, inputClass, useAction, useLoad } from '../components/ui.js';

const PRESET_COLORS = ['#b3241f', '#1b3a6b', '#0f5132', '#6b3fa0', '#c96a3f', '#1d1b18'];

export function TeamsPage() {
  const navigate = useNavigate();
  const teams = useLoad(() => api.teams(), []);
  const [name, setName] = useState('');
  const [primaryColor, setPrimaryColor] = useState(PRESET_COLORS[0]!);

  const create = useAction(async () => {
    const { team } = await api.createTeam({ name: name.trim(), primaryColor });
    navigate(`/teams/${team.id}`);
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-chalk">Teams</h1>
        <p className="mt-1 text-sm text-chalk/60">
          A team is up to 26 cards from your collection, with a lineup of nine hitters and a starting pitcher.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Panel title="Your teams">
          <ErrorNote error={teams.error} />
          {teams.loading && !teams.data ? (
            <Spinner />
          ) : (teams.data?.teams.length ?? 0) === 0 ? (
            <EmptyState title="No teams yet">Create one on the right, then fill it from your collection.</EmptyState>
          ) : (
            <ul className="space-y-2">
              {teams.data!.teams.map((team) => (
                <li key={team.id}>
                  <Link
                    to={`/teams/${team.id}`}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 transition-colors hover:border-gold/40"
                  >
                    <span className="h-4 w-4 shrink-0 rounded-full ring-1 ring-white/25" style={{ background: team.primaryColor ?? '#4b5563' }} />
                    <span className="font-medium text-chalk">{team.name}</span>
                    <span className="font-mono text-xs text-chalk/50">{team.size} cards</span>
                    <span className={`ml-auto text-xs ${team.hasLineup ? 'text-gold' : 'text-chalk/45'}`}>
                      {team.hasLineup ? 'lineup set' : 'no lineup yet'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="New team">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void create.execute();
            }}
          >
            <Field label="Team name">
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={40} placeholder="Bay City Nine" />
            </Field>
            <Field label="Color">
              <div className="flex gap-2">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Color ${color}`}
                    onClick={() => setPrimaryColor(color)}
                    className={`h-8 w-8 rounded-full ring-2 transition-transform ${primaryColor === color ? 'scale-110 ring-gold' : 'ring-white/20'}`}
                    style={{ background: color }}
                  />
                ))}
              </div>
            </Field>
            <ErrorNote error={create.error} />
            <Button type="submit" variant="primary" className="w-full" disabled={create.busy || name.trim().length < 2}>
              {create.busy ? 'Creating…' : 'Create team'}
            </Button>
          </form>
        </Panel>
      </div>
    </div>
  );
}
