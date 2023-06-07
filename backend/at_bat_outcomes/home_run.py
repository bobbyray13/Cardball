#homerun.py
from models import Game, Base, Player
from at_bat_components.update_game import GameUpdate
from database import db

def apply_home_run(game_state):
    # Create a game updater
    game_updater = GameUpdate(game_state, db.session)

    # Get the player who is currently up to bat
    offensive_team = game_state.home_team if game_state.home_team.role == "onOffense" else game_state.away_team
    up_to_bat_player = None
    for player in offensive_team.players:
        if player.role == "upToBat":
            up_to_bat_player = player
            break

    # Advance any runners on bases by four bases
    game_updater.advance_runners(bases_to_advance=4)

    # Batter also scores a run
    print("Home run hit! Adding run to team score.")
    if offensive_team == game_state.home_team:
        game_state.home_team_score += 1
    else:
        game_state.away_team_score += 1

    # Change player's role to None, as they have completed their run
    up_to_bat_player.role = None
    db.session.commit()
#END OF homerun.py