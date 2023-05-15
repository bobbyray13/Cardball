import { Player } from './Player';
import parse from 'csv-parse/lib/sync'; // This is a library for parsing CSV. You may need to install it via npm or yarn

export const csvToPlayerArray = (csvData: string): Player[] => {
  let players: Player[] = [];

  // Parse the CSV data
  const records = parse(csvData, {
    columns: true,
    skip_empty_lines: true
  });

  // Iterate through each record and create a Player object
  for (let record of records) {
    let player = new Player(
      record.name,
      record.position,
      parseInt(record.bat_skill),
      parseInt(record.pow_skill),
      parseInt(record.pit_skill),
      parseInt(record.fld_skill),
      parseInt(record.run_skill),
      record.playerType
    );
    players.push(player);
  }

  return players;
};
