//import { Player } from '../components/Player';
//import { parse } from 'csv-parse';

//export const csvToPlayerArray = (csvData: string): Promise<Player[]> => {
  //return new Promise((resolve, reject) => {
    //const players: Player[] = [];
    //const parser = parse({
      //delimiter: ',',
      //columns: true,
      //skip_empty_lines: true
    //});

    // Use the readable stream api to consume records
//    parser.on('readable', function(){
      //let record;
      //while ((record = parser.read()) !== null) {
//        let player = new Player(
          //record.name,
          //record.position,
          //parseInt(record.bat_skill),
          //parseInt(record.pow_skill),
          //parseInt(record.pit_skill),
          //parseInt(record.fld_skill),
          //parseInt(record.run_skill),
          //record.playerType
        //);
        //players.push(player);
      //}
    //});

    // Catch any error
//    parser.on('error', function(err){
      //reject(err.message);
    //});

    // When all records are read, resolve the promise with players array
  //  parser.on('end', function(){
//      resolve(players);
    //});

    // Write data to the stream
    //parser.write(csvData);
    // Close the readable stream
    //parser.end();
  //});
//};
