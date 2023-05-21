# game_state.py
from models import Game, Team, GameLog
from flask_sqlalchemy import SQLAlchemy
from flask import jsonify, Blueprint
from datetime import datetime
from database import db

game_state_blueprint = Blueprint('game_state', __name__)


@game_state_blueprint.route('/api/game_state/<int:game_id>', methods=['GET'])
def get_game_state(game_id):
    game = Game.query.get(game_id)
    if game:
        return jsonify(game.serialize()), 200
    else:
        return jsonify({'message': 'Game not found.'}), 404

def create_game_log(game: Game, message: str):
    game_log = GameLog(game_id=game.id, log_message=message)
    db.session.add(game_log)
    db.session.commit()

def create_new_game(home_team: Team, away_team: Team) -> Game:
    new_game = Game(
        home_team=home_team,
        away_team=away_team,
        home_team_score=0,
        away_team_score=0,
        current_inning=1,
        current_half='top',
        current_outs=0,
    )
    db.session.add(new_game)
    db.session.commit()

    create_game_log(new_game, "Game started")

    return new_game
#END OF game_state.py