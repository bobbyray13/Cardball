# game_state.py
from models import Game, Team, GameLog
from flask_sqlalchemy import SQLAlchemy
from flask import jsonify
from datetime import datetime
from database import db

def create_game_log(game: Game, message: str):
    game_log = GameLog(game_id=game.id, log_message=message)
    db.session.add(game_log)
    db.session.commit()

def create_new_game(home_team: Team, away_team: Team) -> Game:
    new_game = Game(
        home_team_id=home_team.id,
        away_team_id=away_team.id,
        home_team_score=0,
        away_team_score=0,
        current_inning=1,
        current_half=True,
        current_outs=0,
    )
    db.session.add(new_game)
    db.session.commit()  # Add this line

    create_game_log(new_game, "Game started")

    home_team.game_id = new_game.id
    away_team.game_id = new_game.id

    return new_game
#END OF game_state.py