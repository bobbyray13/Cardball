// //Team.tsx
// import { Team as TeamInterface, Player, PlayerRole, PlayerType } from '../types';

// export const defaultPlayer: Player = {
//     id: 0,
//     name: '',
//     position: 'BN',
//     role: 'onBench',
//     bat_skill: 0,
//     pit_skill: 0,
//     pow_skill: 0,
//     run_skill: 0,
//     fld_skill: 0,
//     playerType: PlayerType.Batter,
//     year: 2000,
// }

// export const defaultTeam: TeamInterface = {
//     id: 0,
//     name: '',
//     benchPlayers: [],
//     score: 0,
//     role: 'onDefense',
//     lineup: [],
//     batters:  [],
//     pitchers: []
// }

// export const createTeam = (id: number, name: string = ''): TeamInterface => {
//     return { ...defaultTeam, id, name };
// };
// //END OF Team.tsx