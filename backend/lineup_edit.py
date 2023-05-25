# lineup_edit.py
from flask import Blueprint, jsonify, request, current_app as app
from models import Player, Team, Game, db
from sqlalchemy.orm.exc import NoResultFound
from database import db

lineup_blueprint = Blueprint('lineup', __name__)

@lineup_blueprint.route('/api/teams/<int:team_id>/get_lineup', methods=['GET'])
def get_lineup(team_id):
    team = Team.query.get(team_id)
    if team is None:
        return jsonify({'message': 'Team not found.'}), 404

    # Serialize only the players in the lineup
    lineup = [Player.query.get(int(player.id)).serialize() for player in team.players] # convert player.id to int

    return jsonify(lineup)

@lineup_blueprint.route('/api/teams/<int:team_id>/lineup', methods=['PUT'])
def update_lineup(team_id):
    data = request.get_json()
    team = Team.query.get(team_id)
    app.logger.debug(f"Update lineup called with data: {data}")

    if team is None:
        return jsonify({'message': 'Team not found.'}), 404

    # Validate lineup and fieldPositions...
    lineup = [int(id) for id in data.get('lineup', [])] # convert all received ids to int
    fieldPositions = data.get('fieldPositions')

    if not lineup or not fieldPositions:
        return jsonify({'message': 'lineup and fieldPositions are required.'}), 400

    # Check that all player IDs in lineup and fieldPositions exist
    player_ids = set(lineup + list(fieldPositions.keys()))
    for player_id in player_ids:
        try:
            player = Player.query.filter(Player.id == player_id).one()
        except NoResultFound:
            return jsonify({'message': f'Player with id {player_id} not found.'}), 404
    
        app.logger.debug(f"Player ids: {player_ids}")

    team.lineup = lineup
    team.fieldPositions = fieldPositions
    db.session.commit()
    app.logger.debug("Lineup and FieldPositions updated successfully")

    return jsonify(team.serialize())

# END OF lineup_edit.py

#substitute_player_blueprint = Blueprint('substitute_player', __name__)

# @substitute_player_blueprint.route('/api/substitute_player', methods=['POST'])
# def substitute_player():
#     data = request.get_json()
#     game_id = data['game_id']
#     team_id = data['team_id']
#     player_out_id = data['player_out_id']
#     player_in_id = data['player_in_id']
#     player_type = data['player_type']

#     game = Game.query.get(game_id)
#     team = Team.query.get(team_id)
#     player_out = Player.query.get(player_out_id)
#     player_in = Player.query.get(player_in_id)

#     if not game or not team or not player_out or not player_in:
#         return jsonify({'message': 'Game, team or player not found.'}), 404

#     # Perform substitution logic here
#     player_out.in_lineup = False
#     player_in.in_lineup = True

#     if player_type == "Pitcher":
#         if player_in in team.pitchers:
#             team.pitchers.remove(player_in)
#         else:
#             team.bench_players.remove(player_in)
#         team.pitchers.append(player_in)

#         if player_out in team.pitchers:
#             team.pitchers.remove(player_out)
#         else:
#             team.bench_players.remove(player_out)
#         team.bench_players.append(player_out)

#     else:
#         if player_in in team.batters:
#             team.batters.remove(player_in)
#         else:
#             team.bench_players.remove(player_in)
#         team.batters.append(player_in)

#         if player_out in team.batters:
#             team.batters.remove(player_out)
#         else:
#             team.bench_players.remove(player_out)
#         team.bench_players.append(player_out)

#     db.session.commit()

#     return jsonify(game.serialize()), 200

