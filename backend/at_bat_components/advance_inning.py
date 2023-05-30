from models import Game
from sqlalchemy.orm import Session

class AdvanceInning:
    def __init__(self, game: Game, session: Session):
        self.game = game
        self.session = session

    def advance(self):
        # Switch roles of home and away teams
        if self.game.home_team.role == 'onDefense':
            self.game.home_team.role = 'onOffense'
            self.game.away_team.role = 'onDefense'
            self.game.current_half = 'bottom'
        else:
            self.game.home_team.role = 'onDefense'
            self.game.away_team.role = 'onOffense'
            self.game.current_half = 'top'
            self.game.current_inning += 1

        # Save changes to the database
        self.session.commit()
