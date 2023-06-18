from models import Game, Player
from sqlalchemy.orm import Session
from database import db

def apply_strikeout(game_state: Game, n: int = 1):
    if n not in [1]:
        raise ValueError(f"Invalid number of outs: {n}. Can only be 1.")

    # Increment outs by n
    game_state.current_outs += n

    # Get the team who is currently up to bat
    offensive_team = game_state.home_team if game_state.home_team.role == "onOffense" else game_state.away_team

    # Reset upToBat player's role to null
    for player in offensive_team.players:
        if player.role == 'upToBat':
            player.role = 'inLineupBatter'
            break

    # Save changes to the database
    db.session.commit()
