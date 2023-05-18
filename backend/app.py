#app.py
from flask import Flask, jsonify, request
from draft import draft_player, draft_blueprint
from game_state import create_new_game, game_state_blueprint
from flask_migrate import Migrate
from database import db
from datetime import datetime
from flask_cors import CORS
import csv

app = Flask(__name__)
CORS(app)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:////Users/Bobby/Documents/Programming/reactprojects/Cardball/backend/cardball.db'
db.init_app(app)
migrate = Migrate(app, db)


with app.app_context():
    from models import Player, Team, Game, GameLog
    db.create_all()

@app.route('/api/games', methods=['POST'])
def create_game():
    data = request.get_json()
    print(f"Received data: {data}")  # Debug: Print received data
    home_team_name = data['home_team_name']
    away_team_name = data['away_team_name']
    print(f"Received request to create game with home team: {home_team_name}, away team: {away_team_name}")
    
    home_team = Team.query.filter_by(name=home_team_name).first()
    if home_team is None:
        home_team = Team(name=home_team_name)
        db.session.add(home_team)
        print(f"Home team: {home_team}")  # Debug: Print home team
    
    away_team = Team.query.filter_by(name=away_team_name).first()
    if away_team is None:
        away_team = Team(name=away_team_name)
        db.session.add(away_team)
        print(f"Away team: {away_team}")  # Debug: Print away team

    game = create_new_game(home_team, away_team)
    if game is None:
        return jsonify({'message': 'Could not create game. Check team names.'}), 400

    game_log_start = GameLog(game_id=game.id, log_message="Game started", timestamp=datetime.now())
    db.session.add(game_log_start)

    db.session.commit()
    
    return jsonify(game.serialize())

@app.route('/api/players', methods=['GET'])
def get_players():
    players = Player.query.all()
    return jsonify([player.serialize() for player in players])

@app.route('/api/load_players', methods=['POST'])
def load_players():
    try:
        with open('./assets/PlayerDatabase.csv', 'r') as file:
            reader = csv.DictReader(file)
            for row in reader:
                player = Player(
                    name=row['name'],
                    position=row['position'],
                    bat_skill=int(row['bat_skill']),
                    pow_skill=int(row['pow_skill']),
                    pit_skill=int(row['pit_skill']),
                    fld_skill=int(row['fld_skill']),
                    run_skill=int(row['run_skill']),
                    playerType=row['playerType'],
                    year=int(row['year'])
                )
                db.session.add(player)
            db.session.commit()
        return jsonify({'message': 'Players loaded successfully.'})
    except Exception as e:
        return jsonify({'message': 'Error occurred: ' + str(e)}), 500

@app.route('/api/teams', methods=['POST'])
def create_team():
    data = request.get_json()
    team = Team(name=data['name'])
    db.session.add(team)
    db.session.commit()
    return jsonify(team.as_dict())

app.register_blueprint(draft_blueprint)

app.register_blueprint(game_state_blueprint)


#@app.route('/api/draft', methods=['POST'])
#def draft():
#    data = request.get_json()
#    return draft_player(data['team_id'], data['player_id'])

@app.route('/api/games/<int:game_id>/play_inning_half', methods=['POST'])
def play_inning_half(game_id):
    game = Game.query.get(game_id)
    # Update the inning half and increment the inning number if necessary
    if game.current_half == 'bottom':
        game.current_half = 'top'
        game.current_inning += 1
    else:
        game.current_half = 'bottom'
    db.session.commit()
    return jsonify(game.as_dict())

@app.route('/api/games/<int:game_id>/end_half_inning', methods=['POST'])
def end_half_inning(game_id):
    game = Game.query.get(game_id)
    # Switch the inning half and reset outs
    if game.current_half == 'top':
        game.current_half = 'bottom'
    else:
        game.current_half = 'top'
    game.current_outs = 0
    db.session.commit()
    return jsonify(game.as_dict())

@app.route('/api/games/<int:game_id>/increment_outs', methods=['POST'])
def increment_outs(game_id):
    game = Game.query.get(game_id)
    # Increment the number of outs
    game.current_outs += 1
    db.session.commit()
    return jsonify(game.as_dict())

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
#END OF app.py