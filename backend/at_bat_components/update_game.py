#update_game.py:
from sqlalchemy.orm import Session
from models import Base
from database import db

class GameUpdate:
    def __init__(self, game, db):
        self.game = game

    def advance_runners(self, bases_to_advance=1):
        # Start from the highest numbered base and advance players towards home
        print('DEBUG: Starting to advance runners')
        for base_number in reversed(range(1, 4)):
            base = next((base for base in self.game.bases if base.base_number == base_number), None)
            if base and base.is_occupied:
                next_base_number = base_number + bases_to_advance
                if next_base_number > 3:  # Player scores
                    print('DEBUG: Player is about to score')
                    self.add_run_to_team_score()
                    base.player.role = 'inLineupBatter'  # Reset player's role
                    base.is_occupied = False
                    base.player_id = None
                    db.session.commit()
                else:  # Move player to next base
                    next_base = next((base for base in self.game.bases if base.base_number == next_base_number), None)
                    if next_base.is_occupied:
                        print("Error: Base already occupied.")
                    else:
                        print(f'DEBUG: Moving player from base {base_number} to base {next_base_number}')
                        next_base.is_occupied = True
                        next_base.player_id = base.player_id
                        next_base.player.role = 'onBase'
                        # Reset current base
                        base.is_occupied = False
                        base.player_id = None
                        db.session.commit()

    def add_run_to_team_score(self):
        offensive_team = self.game.home_team if self.game.home_team.role == "onOffense" else self.game.away_team
        if offensive_team == self.game.home_team:
            self.game.home_team_score += 1
        else:
            self.game.away_team_score += 1
        if offensive_team == self.game.home_team:
            print(f"Run added! {offensive_team.name} score is now {self.game.home_team_score}")
        else:
            print(f"Run added! {offensive_team.name} score is now {self.game.away_team_score}")
        db.session.commit()

    def increment_outs(self):
        self.game.current_outs += 1
        db.session.commit()
#END OF update_game.py