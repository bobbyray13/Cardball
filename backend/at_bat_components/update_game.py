from sqlalchemy.orm import Session
from ..models import Base

class GameUpdate:
    def __init__(self, game, session: Session):
        self.game = game
        self.session = session

    def advance_runners(self, bases_to_advance=1):
        # Start from the highest numbered base and advance players towards home
        for base_number in reversed(range(1, 4)):  # 3, 2, 1
            base = self.game.bases.filter(Base.base_number == base_number).first()
            if base.is_occupied:
                next_base_number = base_number + bases_to_advance
                if next_base_number > 3:  # Player scores
                    base.player.role = None  # Reset player's role
                    self.session.commit()
                    self.add_run_to_team_score()
                else:  # Move player to next base
                    next_base = self.game.bases.filter(Base.base_number == next_base_number).first()
                    next_base.is_occupied = True
                    next_base.player_id = base.player_id
                # Reset current base
                base.is_occupied = False
                base.player_id = None
                self.session.commit()

    def add_run_to_team_score(self):
        offensive_team = self.game.home_team if self.game.home_team.role == "onOffense" else self.game.away_team
        offensive_team.score += 1
        self.session.commit()

    def increment_outs(self):
        self.game.current_outs += 1
        self.session.commit()
