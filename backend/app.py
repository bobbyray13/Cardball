#app.py
from flask import Flask, jsonify, request, Blueprint
from flask_migrate import Migrate
from datetime import datetime
from flask_cors import CORS
import csv
import logging
from socketio_instance import socketio

def create_app(socketio):
    from game_state import create_new_game, reset_all_teams, game_state_blueprint
    from user_input_routes import user_input_blueprint
    from lineup_edit import lineup_blueprint
    from draft import draft_blueprint, draft_player
    from models import Player, Team, Game, GameLog
    from database import db

    app = Flask(__name__)
    socketio.init_app(app)
    CORS(app, resources={r"*": {"origins": "*"}})
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:////Users/Bobby/Documents/Programming/reactprojects/Cardball/backend/cardball.db'
    db.init_app(app)
    migrate = Migrate(app, db)
    logging.basicConfig(filename='server.log', level=logging.DEBUG)

    app.register_blueprint(draft_blueprint)
    app.register_blueprint(game_state_blueprint)
    app.register_blueprint(lineup_blueprint)
    app.register_blueprint(user_input_blueprint)

    return app

#END OF app.py