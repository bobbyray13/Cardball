#app.py
from flask import Flask, jsonify, request, Blueprint
from draft import draft_player, draft_blueprint
from game_state import create_new_game, reset_all_teams, game_state_blueprint
from lineup_edit import lineup_blueprint
#from lineup_edit import substitute_player_blueprint
from flask_migrate import Migrate
from database import db
from datetime import datetime
from flask_cors import CORS
import csv
import logging

app = Flask(__name__)
CORS(app)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:////Users/Bobby/Documents/Programming/reactprojects/Cardball/backend/cardball.db'

db.init_app(app)

migrate = Migrate(app, db)

logging.basicConfig(filename='server.log', level=logging.DEBUG)

with app.app_context():
    from models import Player, Team, Game, GameLog

app.register_blueprint(draft_blueprint)
app.register_blueprint(game_state_blueprint)
app.register_blueprint(lineup_blueprint)
#app.register_blueprint(substitute_player_blueprint)

current_game = None

@app.route('/api/reset_players', methods=['POST'])
def reset_players():
    # Get the current game
    current_game = Game.query.filter_by(is_in_progress=True).first()
    if current_game is None:
        return jsonify({'message': 'No game in progress.'}), 404
    
    print(f"Current game ID: {current_game.id}, Home team ID: {current_game.home_team_id}, Away team ID: {current_game.away_team_id}")

    # Fetch home and away teams from the database
    home_team = Team.query.get(current_game.home_team_id)
    away_team = Team.query.get(current_game.away_team_id)

    # Print roles before update
    print(f"Roles before update: Home team ({home_team.id}): {home_team.role}, Away team ({away_team.id}): {away_team.role}")

    # Reset roles for teams in the current game
    home_team.role = 'onDefense'
    away_team.role = 'onOffense'
    db.session.commit()
    
    # Refresh the home_team and away_team instances
    db.session.refresh(home_team)
    db.session.refresh(away_team)

    # Print roles after update
    home_team = Team.query.get(home_team.id)  # Fetch updated teams
    away_team = Team.query.get(away_team.id)
    print(f"Roles after update: Home team ({home_team.id}): {home_team.role}, Away team ({away_team.id}): {away_team.role}")


    # Print roles for all teams after the update
    teams_all = Team.query.all()
    print("\nTeam roles after update:")
    for team in teams_all:
        print(f"Team {team.id}: {team.role}")

    players = Player.query.all()
    for player in players:
        player.drafted = False
        player.team_id = None

    db.session.commit()

    teams = [home_team, away_team]
    for team in teams:
        team.lineup = []
        team.fieldPositions = {}

    db.session.commit()

    return jsonify({'message': 'All players and team lineups reset successfully.'}), 200

@app.route('/api/games', methods=['POST'])
def create_game():
    reset_all_teams()

    # Set all other games to not in progress
    Game.query.update({Game.is_in_progress: False})

    data = request.get_json()
    print(f"Received data: {data}")  # Debug: Print received data
    home_team_name = data['home_team_name']
    away_team_name = data['away_team_name']
    print(f"Received request to create game with home team: {home_team_name}, away team: {away_team_name}")
    
    home_team = Team.query.filter_by(name=home_team_name).first()
    if home_team is None:
        home_team = Team(name=home_team_name)
        db.session.add(home_team)
        db.session.commit()   # Added commit here
        print(f"Home team: {home_team}")  # Debug: Print home team
    
    away_team = Team.query.filter_by(name=away_team_name).first()
    if away_team is None:
        away_team = Team(name=away_team_name)
        db.session.add(away_team)
        db.session.commit()   # Added commit here
        print(f"Away team: {away_team}")  # Debug: Print away team

    game = create_new_game(home_team, away_team)
    if game is None:
        return jsonify({'message': 'Could not create game. Check team names.'}), 400

    global current_game
    current_game = game
    print(f"\nCurrent game created with ID: {current_game.id}")
    print(f"Home team: {current_game.home_team.id}, Away team: {current_game.away_team.id}")

    game_log_start = GameLog(game_id=game.id, log_message="Game started", timestamp=datetime.now())
    db.session.add(game_log_start)

    db.session.commit()
    
    return jsonify(game.serialize())

@app.route('/api/players', methods=['GET'])
def get_players():
    players = Player.query.filter_by(drafted=False).all()
    return jsonify([player.serialize() for player in players])

@app.route('/api/load_players', methods=['POST'])
def load_players():
    try:
        with open('./assets/PlayerDatabase.csv', 'r') as file:
            reader = csv.DictReader(file)
            for row in reader:
                logging.info(f"Reading row: {row}")  # Log each row that is being read
                existing_player = Player.query.filter_by(name=row['name'], year=row['year']).first()
                if existing_player is None:
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
                    logging.info(f"Added player to session: {player.name}")  # Log each player that is being added
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

@app.route('/api/games/<int:game_id>/play_inning', methods=['POST'])
def play_inning_half(game_id):
    game = Game.query.get(game_id)
    # Update the inning half, increment the inning number if necessary, and reset outs
    if game.current_half == 'bottom':
        game.current_half = 'top'
        game.current_inning += 1
    else:
        game.current_half = 'bottom'
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