# game_state.py
from models import Game, Team, GameLog, Base, Player
from flask_sqlalchemy import SQLAlchemy
from flask import jsonify, Blueprint, request
from datetime import datetime
from database import db
import json

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

@game_state_blueprint.route('/api/games', methods=['POST'])
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

    game_log_start = GameLog(game_id=game.id, log_message="Game started", timestamp=datetime.now())
    db.session.add(game_log_start)

    db.session.commit()
    
    return jsonify(game.serialize())

@game_state_blueprint.route('/api/teams', methods=['POST'])
def create_team():
    data = request.get_json()
    team = Team(name=data['name'])
    db.session.add(team)
    db.session.commit()
    return jsonify(team.as_dict())

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

    # Create bases
    for base_number in range(1, 4):
        base = Base(
            base_number=base_number,
            is_occupied=False,
            game=new_game,
        )
        db.session.add(base)

    db.session.commit()

    create_game_log(new_game, "Game started")

    return new_game

@game_state_blueprint.route('/api/games/pre-built', methods=['POST'])
def create_game_with_pre_built_teams():
    data = request.get_json()
    away_team_name = data['away_team_name'].lower()
    home_team_name = data['home_team_name'].lower()

    reset_all_teams()
    Game.query.update({Game.is_in_progress: False})
    db.session.commit() # commit database changes

    home_team = get_pre_built_team(home_team_name)  # This would be a new function that fetches a pre-built team with its pre-selected players
    away_team = get_pre_built_team(away_team_name)  # Similarly, fetch the away pre-built team

    if not home_team or not away_team:
        return jsonify({'message': 'Could not fetch teams. Check team names.'}), 400

    # Use the existing create_new_game function
    game = create_new_game(home_team, away_team)
    if game is None:
        return jsonify({'message': 'Could not create game. Check team names.'}), 400

    return jsonify(game.serialize())

def get_pre_built_team(team_name):
    try:
        # Open the corresponding JSON file
        with open(f'pre_built_teams/{team_name}.json', 'r') as file:
            team_data = json.load(file)
        
        # Fetch the corresponding Team object from the database
        team = Team.query.get(team_data['id'])
        
        # Assign the players to the team
        team.players = Player.query.filter(Player.id.in_(team_data['players'])).all()
        team.batters = Player.query.filter(Player.id.in_(team_data['batters'])).all()
        team.pitchers = Player.query.filter(Player.id.in_(team_data['pitchers'])).all()

        db.session.commit() # commit database changes

        return team

    except FileNotFoundError:
        print(f"No pre-built team found for the name {team_name}.")
        return None

def reset_all_teams():
    # Print roles for all teams before the update
    print("\nTeam roles before update:")
    teams_all = Team.query.all()
    for team in teams_all:
        print(f"Team {team.id}: {team.role}")

    # Reset roles for all teams in the database
    for team in teams_all:
        team.role = None

    db.session.commit()

    # Print roles for all teams after the first update
    print("\nTeam roles after first update:")
    for team in teams_all:
        print(f"Team {team.id}: {team.role}")

#END OF game_state.py