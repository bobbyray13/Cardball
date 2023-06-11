# my_socketio.py
from flask import Flask
from flask_socketio import emit
from models import Game
from socketio_instance import socketio

def setup_socketio_events(socketio):
    @socketio.on('connect')
    def test_connect():
        print('Client connected')
        socketio.emit('after connect',  {'data': 'Connected'})

    @socketio.on('disconnect')
    def test_disconnect():
        print('Client disconnected')

def update_game_state(socketio, game_id):
    # Here you would fetch the game state from your database
    game = Game.query.filter_by(id=game_id).first()
    if game:
        game_state = game.serialize()

        print(f"Game state for game {game_id} communicated")

        # Now emit the game state to all connected clients
        socketio.emit('GAME_UPDATE', game_state)
        print(f"Emitted GAME_UPDATE event for game {game_id}")
    else:
        print(f"No game found with ID {game_id}")

# END OF my_socketio.py