# user_input_routes.py
from flask import Blueprint, request, jsonify
from sqlalchemy.orm import Session
from at_bat_components.at_bat import AtBat
from models import Game
from database import db
from socketio_instance import socketio

user_input_blueprint = Blueprint('user_input_bp', __name__)

@user_input_blueprint.route('/api/games/<int:game_id>/next_pitch', methods=['POST'])
def next_pitch(game_id: int):
    print(f"Received request to roll for next pitch for game_id: {game_id}")  # Debug print
    from gameplay import Gameplay

    game = Gameplay(game_id, socketio)
    game.start()

    # Reload the game_state object after making changes to it
    db.session.refresh(game.game_state)

    # Convert the game_state object to a dict and return it
    game_state_dict = {column.name: getattr(game.game_state, column.name) for column in game.game_state.__table__.columns}

    print(f"Returning game state dict: {game_state_dict}")  # Debug print

    return jsonify({
        'gameState': game_state_dict,
    }), 200

@user_input_blueprint.route('/api/games/<int:game_id>/first_at_bat', methods=['POST'])
def first_at_bat(game_id: int):
    print(f"Received request to set up initial at bat for game_id: {game_id}")  # Debug print
    from at_bat_components.at_bat import AtBat

    # Fetch the game from the database
    game = Game.query.get(game_id)

    # Check if the game exists
    if game is None:
        return "Game not found", 404

    # Set the home_team role as 'onDefense' and away_team role as 'onOffense':
    game.home_team.role = 'onDefense'
    game.away_team.role = 'onOffense'

    # Commit the changes to the database
    db.session.commit()

    # Initiate the AtBat
    at_bat = AtBat(game, socketio)
    at_bat.at_bat()

    return "AtBat initiated successfully", 200  # Return a success response

#END OF user_input_routes.py
