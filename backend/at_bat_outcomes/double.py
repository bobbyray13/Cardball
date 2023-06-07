from models import Game, Base, Player
from at_bat_components.update_game import GameUpdate
from database import db

def apply_double(game_state):
    # Create a game updater
    game_updater = GameUpdate(game_state, db.session)

    # Get the player who is currently up to bat
    offensive_team = game_state.home_team if game_state.home_team.role == "onOffense" else game_state.away_team
    up_to_bat_player = None
    for player in offensive_team.players:
        if player.role == "upToBat":
            up_to_bat_player = player
            break

    # Change player's role to 'onBase'
    if up_to_bat_player is not None:
        up_to_bat_player.role = "onBase"
    else:
        raise Exception("No player is currently up to bat.")

    # Advance any runners on bases by two bases
    game_updater.advance_runners(bases_to_advance=2)

    # Put up_to_bat_player on first base
    second_base = None
    for base in game_state.bases:
        if base.base_number == 2:
            second_base = base
            break
    # Make sure second base is not already occupied
    if not second_base.is_occupied:
        second_base.is_occupied = True
        second_base.player_id = up_to_bat_player.id
    else:
        raise Exception("Second base is already occupied. Check the advance_runners method.")
    
    # Now commit to the database after all changes are made
    db.session.commit()
