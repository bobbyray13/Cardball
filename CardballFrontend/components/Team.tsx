import { Team as TeamInterface } from '../types';

export const Team = {
  homeTeam: '',
  awayTeam: '',

  setTeams(homeTeam: string, awayTeam: string) {
    this.homeTeam = homeTeam;
    this.awayTeam = awayTeam;
  },

  getTeams(): { homeTeam: TeamInterface, awayTeam: TeamInterface } {
    return {
      homeTeam: { id: 1, name: this.homeTeam, players: [], benchPlayers: [], score: 0, role: 'onDefense', lineup: [] },
      awayTeam: { id: 2, name: this.awayTeam, players: [], benchPlayers: [], score: 0, role: 'onOffense', lineup: [] },
    };
  },
};
