from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from at_bat_components.at_bat import AtBat
from at_bat_outcomes.single import apply_single
from at_bat_outcomes.double import apply_double
from at_bat_outcomes.triple import apply_triple
from at_bat_outcomes.home_run import apply_home_run
from at_bat_outcomes.strikeout import apply_strikeout
from at_bat_outcomes.out import apply_out
from models import Game

class Gameplay:
    def __init__(self, game_id):
        engine = create_engine('postgresql://user:pass@localhost:5432/mydatabase')
        Session = sessionmaker(bind=engine)
        self.session = Session()
        self.game_state = self.session.query(Game).filter_by(id=game_id).one()  # Fetch game with id game_id
        self.game_over = False

    def play_at_bat(self):
        # Create an AtBat instance
        at_bat = AtBat(self.game_state, self.session)
        # Perform the at bat
        outcome = at_bat.at_bat()  # The at_bat function returns the outcome of an at bat
        # Update the game state based on the outcome
        if outcome == 'Strikeout':
            apply_strikeout(self.game_state, self.session)
        elif outcome == 'Out':
            apply_out(self.game_state, self.session)
        elif outcome == 'Single':
            apply_single(self.game_state, self.session)
        elif outcome == 'Double':
            apply_double(self.game_state, self.session)
        elif outcome == 'Triple':
            apply_triple(self.game_state, self.session)
        elif outcome == 'Home Run':
            apply_home_run(self.game_state, self.session)
        else:
            raise ValueError(f"Unknown outcome: {outcome}")
        # commit the session to save these changes to the database
        self.session.commit()

    def advance_inning_if_needed(self):
        if self.game_state.outs >= 3:  # If there are three outs
            self.game_state.outs = 0  # Reset the outs
            if self.game_state.current_inning % 2 == 0:  # Top of inning, advance to bottom
                self.game_state.current_half = 'bottom'
                # Reset the bases
                self.game_state.first_base = None
                self.game_state.second_base = None
                self.game_state.third_base = None
                # Update the teams' roles and their pitchers' statuses
                self.game_state.home_team.role = 'onOffense'
                self.game_state.away_team.role = 'onDefense'
                # Clear the status of players on base
                for base in self.game_state.bases:
                    if base.player and base.player.role == 'onBase':
                        base.player.role = None
            else:  # Bottom of inning, advance to top of next inning
                self.game_state.current_inning += 1
                self.game_state.current_half = 'top'
                # Reset the bases
                self.game_state.first_base = None
                self.game_state.second_base = None
                self.game_state.third_base = None
                # Update the teams' roles and their pitchers' statuses
                self.game_state.home_team.role = 'onDefense'
                self.game_state.away_team.role = 'onOffense'
                # Clear the status of players on base
                for base in self.game_state.bases:
                    if base.player and base.player.role == 'onBase':
                        base.player.role = None

    def check_game_over(self):
        # If we're in the bottom of the 9th inning or later
        if self.game_state.current_inning >= 9 and self.game_state.current_half == 'bottom':
            # If the home team is in the lead
            if self.game_state.home_team_score > self.game_state.away_team_score:
                self.game_over = True
                self.winner = self.game_state.home_team
        # Else if we've completed a full 9 innings (or more)
        elif self.game_state.current_inning > 9 or (self.game_state.current_inning == 9 and self.game_state.current_half == 'top'):
            # If the away team is in the lead at the top of an inning
            if self.game_state.away_team_score > self.game_state.home_team_score:
                self.game_over = True
                self.winner = self.game_state.away_team
            # Or if we've completed the bottom of the inning and the home team is in the lead
            elif self.game_state.current_half == 'bottom' and self.game_state.home_team_score > self.game_state.away_team_score:
                self.game_over = True
                self.winner = self.game_state.home_team

    def game_loop(self):
        while not self.game_over:
            self.play_at_bat()
            self.advance_inning_if_needed()
            self.check_game_over()

        # commit the session one last time to save the final game state
        self.session.commit()

        print(f"{self.winner.name} is the winner!")  # Announce the winner
        self.session.close()  # Close the session

        # return the game state
        return self.game_state
