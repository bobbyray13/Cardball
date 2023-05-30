from sqlalchemy.orm import Session
from .up_to_defend import UpToDefend
from .rolls import roll_dice, pitch_roll, swing_roll, contact_roll, throw_roll
from .update_game import GameUpdate
from ..models import Player, Team, Game, Base  # Import your models

class AtBat:

    def __init__(self, game: Game, session: Session):
        self.game = game
        self.session = session
        self.fouls = 0  # Initialize fouls to 0
        self.defend = UpToDefend(self.game, self.session)
        self.update_game = GameUpdate(self.game, self.session)

    def up_to_bat_steps_up(self):
        offensive_team = self.game.home_team if self.game.home_team.role == "onOffense" else self.game.away_team
        
        if offensive_team == self.game.home_team:
            self.up_to_bat = offensive_team.lineup[self.game.home_team_lineup_position % len(offensive_team.lineup)]
            self.game.home_team_lineup_position += 1
        else:
            self.up_to_bat = offensive_team.lineup[self.game.away_team_lineup_position % len(offensive_team.lineup)]
            self.game.away_team_lineup_position += 1

    def print_game_state(self):
        print(self.game.serialize())

    def pitching_performs_pitch_roll(self):
        defensive_team = self.game.home_team if self.game.home_team.role == "onDefense" else self.game.away_team
        self.up_to_pitch = defensive_team.pitchers[0]  # Simplified, takes first pitcher
        self.pitch_roll = roll_dice(6, self.up_to_pitch.pit_skill)

    def up_to_bat_performs_swing_roll(self):
        self.swing_roll = roll_dice(6, self.up_to_bat.bat_skill)

    def up_to_bat_performs_contact_roll(self):
        self.power_roll, self.direction_roll = contact_roll(self.up_to_bat)

    def determine_up_to_defend_based_on_roll(self):
        # Reset upToDefend role for all players
        for player in self.session.query(Player).filter(Player.role == 'upToDefend').all():
            player.role = None

        # Determine the player who is up to defend
        self.up_to_defend = self.defend.determine_up_to_defend_based_on_roll(self.direction_roll, self.power_roll)

        # Update the role of the chosen player to 'upToDefend'
        if self.up_to_defend:
            self.up_to_defend.role = 'upToDefend'
            self.session.commit()

    def up_to_defend_performs_throw_roll(self):
        if self.up_to_defend:
            self.fielding_roll = throw_roll(self.up_to_defend)

    def reset_up_to_defend(self):
        if self.up_to_defend:
            self.up_to_defend.role = None
            self.session.commit()

    def count_as_strikeout(self):
        print(f"{self.up_to_bat.name} strikes out!")

    def count_as_walk(self):
        print(f"{self.up_to_bat.name} walks!")

    def count_as_foul(self):
        self.fouls += 1  # Increment fouls
        print(f"{self.up_to_bat.name} fouls!")

    def at_bat(self):
        # update the role of up_to_bat player
        self.up_to_bat.role = 'upToBat'
        self.session.commit()
        self.up_to_bat_steps_up()
        self.print_game_state()
        def start(self, wait_for_user_input: bool = False):
            if wait_for_user_input:
                # Do nothing, wait for user input to perform pitch roll
                pass
            else:
                self.pitching_performs_pitch_roll()
                self.pitching_performs_pitch_roll()
                self.up_to_bat_performs_swing_roll()

                outcome = None  # Initialize outcome variable

                if self.swing_roll > self.pitch_roll:  # Contact
                    self.up_to_bat_performs_contact_roll()
                    self.determine_up_to_defend_based_on_roll()
                    self.up_to_defend_performs_throw_roll()
                    if self.fielding_roll > self.power_roll:
                        print(f"{self.up_to_bat.name} is out!")
                        self.update_game.increment_outs()
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
                    self.update_game.increment_outs()
                    outcome = 'Strikeout'
                else:  # Tie
                    self.count_as_foul()
                    if self.fouls == 3:
                        self.count_as_walk()
                        outcome = 'Walk'

                self.fouls = 0  # Reset fouls count after each at bat

                # reset the role of up_to_defend player after the play is over
                self.reset_up_to_defend()
                # also reset the role of up_to_bat player
                self.session.commit()
