from models import Game, Base, Player
from at_bat_components.update_game import GameUpdate

def apply_home_run(game_state, session):
    # Create a game updater
    game_updater = GameUpdate(game_state, session)

    # Get the player who is currently up to bat
    offensive_team = game_state.home_team if game_state.home_team.role == "onOffense" else game_state.away_team
    up_to_bat_player = offensive_team.players.filter(Player.role == "upToBat").first()

    # Advance any runners on bases by four bases
    game_updater.advance_runners(bases_to_advance=4)

    # Batter also scores a run
    game_updater.add_run_to_team_score()

    # Change player's role to None, as they have completed their run
    up_to_bat_player.role = None
    session.commit()