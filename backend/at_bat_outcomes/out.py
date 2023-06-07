#out.py
from sqlalchemy.orm import Session
from models import Game, Player
from database import db

def apply_out(game_state: Game, n: int):
    """
    Apply an out to the game state. The number of outs (n) can be 1, 2, or 3.
    """
    # Validate that n is within acceptable range
    if n not in [1, 2, 3]:
        raise ValueError(f"Invalid number of outs: {n}. Can only be 1, 2, or 3.")

    # Increment outs by n
    game_state.current_outs += n

    # Get the team who is currently up to bat
    offensive_team = game_state.home_team if game_state.home_team.role == "onOffense" else game_state.away_team

    # Reset upToBat player's role to null
    for player in offensive_team.players:
        if player.role == 'upToBat':
            player.role = None
            break

    # Save changes to the database
    db.session.commit()
#END OF out.py