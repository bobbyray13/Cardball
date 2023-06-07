#single.py:
from models import Game, Base, Player
from at_bat_components.update_game import GameUpdate
from database import db

def apply_single(game_state):
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
        print("First base occupied. Cannot add player to first base. Initiating advance_runners.")
        raise Exception("No player is currently up to bat.")

    # Advance any runners on bases
    print('DEBUG: About to apply single and advance runners')
    game_updater.advance_runners()

    # Put up_to_bat_player on first base
    first_base = None
    for base in game_state.bases:
        if base.base_number == 1:
            first_base = base
            break
    # Make sure first base is not already occupied
    if not first_base.is_occupied:
        first_base.is_occupied = True
        first_base.player_id = up_to_bat_player.id
    else:
        raise Exception("First base is already occupied. Check the advance_runners method.")
    
    # Now commit to the database after all changes are made
    db.session.commit()
#END OF single.py