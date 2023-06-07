#at_bat.py:
from sqlalchemy.orm import Session
from .up_to_defend import UpToDefend
from .rolls import roll_dice, pitch_roll, swing_roll, contact_roll, throw_roll
from .update_game import GameUpdate
from models import Player, Team, Game, Base  # Import your models
from database import db

class AtBat:

    def __init__(self, game: Game, db):
        self.game = game
        self.fouls = 0  # Initialize fouls to 0
        self.defend = UpToDefend(self.game, db)
        self.update_game = GameUpdate(self.game, db)
        self.up_to_defend = None  # Initialize up_to_defend to None
        self.fielding_roll = 0

    def up_to_bat_steps_up(self):
        offensive_team = self.game.home_team if self.game.home_team.role == "onOffense" else self.game.away_team
        
        if offensive_team == self.game.home_team:
            player_id = offensive_team.lineup[self.game.home_team_lineup_position % len(offensive_team.lineup)]
            self.up_to_bat = db.session.query(Player).get(player_id)
            self.game.home_team_lineup_position += 1
        else:
            player_id = offensive_team.lineup[self.game.away_team_lineup_position % len(offensive_team.lineup)]
            self.up_to_bat = db.session.query(Player).get(player_id)
            self.game.away_team_lineup_position += 1
        db.session.commit()

    def print_game_state(self):
        print(self.game.serialize())

    def pitching_performs_pitch_roll(self):
        defensive_team = self.game.home_team if self.game.home_team.role == "onDefense" else self.game.away_team
        print("Field positions: ", defensive_team.fieldPositions)
        pitcher_id = int(defensive_team.fieldPositions.get('P')) if defensive_team.fieldPositions.get('P') is not None else None
        if pitcher_id is not None:
            self.up_to_pitch = next((player for player in defensive_team.players if player.id == pitcher_id), None)
        else:
            self.up_to_pitch = None

        if self.up_to_pitch is None:
            raise ValueError("No pitcher found on the defensive team")
        self.pitch_roll = roll_dice(6, self.up_to_pitch.pit_skill)
        print(f'Pitch roll: {self.pitch_roll}')

    def up_to_bat_performs_swing_roll(self):
        self.swing_roll = roll_dice(6, self.up_to_bat.bat_skill)
        print(f'Swing roll: {self.swing_roll}')

    def up_to_bat_performs_contact_roll(self):
        self.power_roll, self.direction_roll = contact_roll(self.up_to_bat)
        print(f'Contact roll: Power Roll - {self.power_roll}, Direction Roll - {self.direction_roll}')

    def determine_up_to_defend_based_on_roll(self):
        # Reset upToDefend role for all players
        for player in db.session.query(Player).filter(Player.role == 'upToDefend').all():
            player.role = None

        # Determine the player who is up to defend
        self.up_to_defend = self.defend.determine_up_to_defend_based_on_roll(self.direction_roll, self.power_roll)

        # Update the role of the chosen player to 'upToDefend'
        if self.up_to_defend:
            self.up_to_defend.role = 'upToDefend'
            db.session.commit()

    def up_to_defend_performs_throw_roll(self):
        if self.up_to_defend:
            self.fielding_roll = throw_roll(self.up_to_defend)
            print(f'Throw roll: {self.fielding_roll}')

    def reset_up_to_defend(self):
        if self.up_to_defend:
            self.up_to_defend.role = None
            db.session.commit()

    def count_as_strikeout(self):
        print(f"{self.up_to_bat.name} strikes out!")

    def count_as_walk(self):
        print(f"{self.up_to_bat.name} walks!")

    def count_as_foul(self):
        self.fouls += 1  # Increment fouls
        print(f"{self.up_to_bat.name} fouls!")

    def at_bat(self):
        # update the role of up_to_bat player
        self.up_to_bat_steps_up()
        self.up_to_bat.role = 'upToBat'
        print(f"New batter is: {self.up_to_bat.name}")
        db.session.commit()
        print("At Bat initialized")

    def start(self, wait_for_user_input: bool = False):
        if wait_for_user_input:
            # Do nothing, wait for user input to perform pitch roll
            pass
        else:
            self.pitching_performs_pitch_roll()
            self.up_to_bat_performs_swing_roll()

            outcome = None  # Initialize outcome variable

            if self.swing_roll > self.pitch_roll:  # Contact
                self.up_to_bat_performs_contact_roll()
                self.determine_up_to_defend_based_on_roll()
                self.up_to_defend_performs_throw_roll()
                if self.up_to_defend and self.fielding_roll > self.power_roll:
                    print(f"{self.up_to_bat.name} is out!")
                    outcome = 'Out'
                else:
                    if self.power_roll < 10:
                        outcome = 'Single'
                        print(f"{self.up_to_bat.name} makes a single!")
                    elif 10 <= self.power_roll < 15:
                        outcome = 'Double'
                        print(f"{self.up_to_bat.name} makes a double!")
                    elif 15 <= self.power_roll < 20:
                        outcome = 'Triple'
                        print(f"{self.up_to_bat.name} makes a triple!")
                    else:
                        outcome = 'Home Run'
                        print(f"{self.up_to_bat.name} makes a home run!")
            elif self.swing_roll < self.pitch_roll:  # No contact
                self.count_as_strikeout()
                outcome = 'Strikeout'
            else:  # Tie
                self.count_as_walk()
                outcome = 'Walk'
                # if self.fouls == 3:
                #     self.count_as_walk()
        
            self.fouls = 0  # Reset fouls count after each at bat

            # reset the role of up_to_defend player after the play is over
            self.reset_up_to_defend()

            db.session.commit()

        return outcome
#END OF at_bat.py