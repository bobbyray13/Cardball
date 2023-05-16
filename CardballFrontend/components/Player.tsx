//Player.tsx:
export class Player {
    name: string;
    position: string;
    bat_skill: number;
    pow_skill: number;
    pit_skill: number;
    fld_skill: number;
    run_skill: number;
    playerType: string;
  
    constructor(
      name: string,
      position: string,
      bat_skill: number,
      pow_skill: number,
      pit_skill: number,
      fld_skill: number,
      run_skill: number,
      playerType: string
    ) {
      this.name = name;
      this.position = position;
      this.bat_skill = bat_skill;
      this.pow_skill = pow_skill;
      this.pit_skill = pit_skill;
      this.fld_skill = fld_skill;
      this.run_skill = run_skill;
      this.playerType = playerType;
    }
  }
//END OF Player.tsx