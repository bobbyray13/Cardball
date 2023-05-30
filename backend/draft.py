# draft.py
from .models import Player, Team, Game
from flask import jsonify, request, Blueprint
from .database import db
from sqlalchemy.orm import joinedload
import logging
import csv

draft_blueprint = Blueprint('draft', __name__)

def draft_player(team_id, player_id):
    team = Team.query.get(team_id)
    player = Player.query.get(player_id)

    if not team or not player:
        return jsonify({'message': 'Team or player not found.'}), 404

    player.team_id = team.id
    player.drafted = True

    if player.playerType == 'Batter':
        team.batters.append(player)
    elif player.playerType == 'Pitcher':
        team.pitchers.append(player)

    db.session.commit()
    db.session.refresh(team)

    updated_team = Team.query.options(joinedload(Team.batters), joinedload(Team.pitchers), joinedload(Team.players)).get(team_id)

    if updated_team:
        return jsonify({'message': 'Player drafted successfully.'}), 200
    else:
        return jsonify({'message': 'Error retrieving updated team.'}), 500


@draft_blueprint.route('/api/draft', methods=['POST'])
def draft():
    data = request.get_json()
    return draft_player(data['team_id'], data['player_id'])

@draft_blueprint.route('/api/players', methods=['GET'])
def get_players():
    players = Player.query.filter_by(drafted=False).all()
    return jsonify([player.serialize() for player in players])

@draft_blueprint.route('/api/load_players', methods=['POST'])
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
#END OF draft.py