# user_input_routes.py
from flask import Blueprint, request, jsonify
from sqlalchemy.orm import Session
from .at_bat_components.at_bat import AtBat
from .models import Game

user_input_blueprint = Blueprint('user_input_bp', __name__)

@user_input_blueprint.route('/games/<int:game_id>/next_pitch', methods=['POST'])
def next_pitch(game_id: int):
    from gameplay import Gameplay

    game = Gameplay(game_id)
    game.play_at_bat()

    inning_ended = False
    if game.game_state.outs >= 3:
        game.advance_inning_if_needed()
        inning_ended = True

    game_ended = False
    if game.game_state.current_inning >= 9:
        game.check_game_over()
        if game.game_over:
            game_ended = True

    # Reload the game_state object after making changes to it
    game.session.refresh(game.game_state)

    # Convert the game_state object to a dict and return it
    game_state_dict = {column.name: getattr(game.game_state, column.name) for column in game.game_state.__table__.columns}

    return jsonify({
        'gameState': game_state_dict,
        'inningEnded': inning_ended,
        'gameEnded': game_ended,
        'winner': game.winner.name if game_ended else None
    }), 200
