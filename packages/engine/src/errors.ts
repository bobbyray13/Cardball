/** A user-facing rules violation (bad lineup, illegal sub, acting out of turn…). */
export class GameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GameError';
  }
}
