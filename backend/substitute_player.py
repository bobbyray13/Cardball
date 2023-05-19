from flask import Blueprint, jsonify, request
from models import Player, Team, Game
from database import db

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