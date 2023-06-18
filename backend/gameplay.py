#gameplay.py:
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from at_bat_components.at_bat import AtBat
from at_bat_outcomes.single import apply_single
from at_bat_outcomes.double import apply_double
from at_bat_outcomes.triple import apply_triple
from at_bat_outcomes.home_run import apply_home_run
from at_bat_outcomes.strikeout import apply_strikeout
from at_bat_outcomes.out import apply_out
from at_bat_outcomes.walk import apply_walk
from my_socketio import update_game_state
from socketio_instance import socketio
from models import Game
from database import db
from at_bat_components.at_bat import AtBat

class Gameplay:
    def __init__(self, game_id, socket):
        self.game_state = db.session.query(Game).filter_by(id=game_id).one()  # Fetch game with id game_id
        self.game_over = False
        self.socketio = socketio  # Use the imported socketio instance
        self.socket = socket

    def play_at_bat(self, socket):
        print(f"Starting at bat for game {self.game_state.id}")
        at_bat = AtBat(self.game_state, db)

        outcome = at_bat.start(self.socket)  # The start function returns the outcome of an at bat
        if outcome == 'Strikeout':
            print("Strikeout recorded. Applying Strikeout.")
            apply_strikeout(self.game_state, n=1)
        elif outcome == 'Out':
            print("Out recorded. Applying out.")
            apply_out(self.game_state, n=1)
        elif outcome == 'Single':
            print("Single hit. Applying single.")
            apply_single(self.game_state)
        elif outcome == 'Double':
            print("Double hit. Applying double.")
            apply_double(self.game_state)
        elif outcome == 'Triple':
            print("Triple hit. Applying triple.")
            apply_triple(self.game_state)
        elif outcome == 'Home Run':
            print("Home run hit. Applying home run.")
            apply_home_run(self.game_state)
        elif outcome == 'Walk':
            print("Walk occurred. Applying walk.")
            apply_walk(self.game_state)    
        else:
            raise ValueError(f"Unknown outcome: {outcome}")
        
        at_bat.advance_lineup_position()
                
        db.session.commit()
        
        # Call advance_inning_if_needed and check_game_over after applying the at-bat outcome.
        self.advance_inning_if_needed(db, socket)
        self.check_game_over(socket)
        at_bat.at_bat()

        db.session.commit()

        print(f"Game state updated for game {self.game_state.id}")

        # Emit the updated game state
        update_game_state(self.socket, self.game_state.id)

    def advance_inning_if_needed(self, db, socket):
        at_bat = AtBat(self.game_state, db)
        if self.game_state.current_outs >= 3:  # If there are three outs
            print("3 outs, advancing half inning")
            self.game_state.current_outs = 0  # Reset the outs
            if self.game_state.current_half == 'top':  # Top of inning, advance to bottom
                self.game_state.current_half = 'bottom'
                # # Reset the bases
                # self.game_state.first_base = None
                # self.game_state.second_base = None
                # self.game_state.third_base = None
                # Update the teams' roles and their pitchers' statuses
                self.game_state.home_team.role = 'onOffense'
                self.game_state.away_team.role = 'onDefense'
                # Clear the status of players on base
                for base in self.game_state.bases:
                    if base.player and base.player.role == 'onBase':
                        base.player.role = 'inLineupBatter'
                        base.is_occupied = False
                at_bat.at_bat()
                socket.emit('game_event', {'description': f"Three outs. Moving to the bottom of the inning."})
            else:  # Bottom of inning, advance to top of next inning
                self.game_state.current_inning += 1
                self.game_state.current_half = 'top'
                # # Reset the bases
                # self.game_state.first_base = None
                # self.game_state.second_base = None
                # self.game_state.third_base = None
                # Update the teams' roles and their pitchers' statuses
                self.game_state.home_team.role = 'onDefense'
                self.game_state.away_team.role = 'onOffense'
                # Clear the status of players on base
                for base in self.game_state.bases:
                    if base.player and base.player.role == 'onBase':
                        base.player.role = 'inLineupBatter'
                        base.is_occupied = False
                at_bat.at_bat()
                socket.emit('game_event', {'description': f"Three outs. Moving to the top of the next inning."})
                
            print("Not 3 outs yet, continue current inning")

    def check_game_over(self, socket):
        # If we're in the bottom of the 9th inning or later
        if self.game_state.current_inning >= 9 and self.game_state.current_half == 'bottom':
            # If the home team is in the lead
            if self.game_state.home_team_score > self.game_state.away_team_score:
                self.game_over = True
                self.winner = self.game_state.home_team
                socket.emit('game_event', {'description': f"Game over! {self.winner.name} wins with a score of {self.game_state.home_team_score} to {self.game_state.away_team_score}!"})
        # Else if we've completed a full 9 innings (or more)
        elif self.game_state.current_inning > 9 or (self.game_state.current_inning == 9 and self.game_state.current_half == 'top'):
            # If the away team is in the lead at the top of an inning
            if self.game_state.away_team_score > self.game_state.home_team_score:
                self.game_over = True
                self.winner = self.game_state.away_team
                socket.emit('game_event', {'description': f"Game over! {self.winner.name} wins with a score of {self.game_state.away_team_score} to {self.game_state.home_team_score}!"})
            # Or if we've completed the bottom of the inning and the home team is in the lead
            elif self.game_state.current_half == 'bottom' and self.game_state.home_team_score > self.game_state.away_team_score:
                self.game_over = True
                self.winner = self.game_state.home_team
                socket.emit('game_event', {'description': f"Game over! {self.winner.name} wins with a score of {self.game_state.home_team_score} to {self.game_state.away_team_score}!"})
        return self.game_state

    
    def start(self):
        try:
            print(f"Starting game {self.game_state.id}")
            self.play_at_bat(self.socket)
            print(f"Game {self.game_state.id} started")
        except ValueError as error:
            print(f"Error while starting game {self.game_state.id}: {error}")

#END OF gameplay.py