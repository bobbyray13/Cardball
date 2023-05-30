from at_bat_components.update_game import GameUpdate
from sqlalchemy.orm import Session
from models import Game, Player

class StrikeOut:
    def __init__(self, game: Game, session: Session):
        self.game = game
        self.session = session

    def apply_strike_out(self, n: int):
        """
        Apply a strike out to the game state. The number of outs (n) can only be 1
        """
        # Validate that n is within acceptable range
        if n not in [1]:
            raise ValueError(f"Invalid number of outs: {n}. Can only be 1.")

        # Increment outs by n
        self.game.current_outs += n

        # Reset upToBat player's role to null
        up_to_bat_players = self.session.query(Player).filter_by(role='upToBat').all()
        for player in up_to_bat_players:
            player.role = None

        # Save changes to the database
        self.session.commit()
