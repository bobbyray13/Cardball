from models import Game, Base, Player
from at_bat_components.update_game import GameUpdate

def apply_double(game_state, session):
    # Create a game updater
    game_updater = GameUpdate(game_state, session)

    # Get the player who is currently up to bat
    offensive_team = game_state.home_team if game_state.home_team.role == "onOffense" else game_state.away_team
    up_to_bat_player = offensive_team.players.filter(Player.role == "upToBat").first()

    # Change player's role to 'onBase'
    up_to_bat_player.role = "onBase"
    session.commit()

    # Advance any runners on bases by two bases
    game_updater.advance_runners(bases_to_advance=2)

    # Put up_to_bat_player on second base
    second_base = game_state.bases.filter(Base.base_number == 2).first()
    # Make sure second base is not already occupied
    if not second_base.is_occupied:
        second_base.is_occupied = True
        second_base.player_id = up_to_bat_player.id
        session.commit()
    else:
        raise Exception("Second base is already occupied. Check the advance_runners method.")
