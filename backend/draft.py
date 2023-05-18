# draft.py
from models import Player, Team, Game
from flask import jsonify, request, Blueprint
from models import Player, Team, Game
from database import db
from sqlalchemy.orm import joinedload

draft_blueprint = Blueprint('draft', __name__)

def draft_player(team_id, player_id):
    team = Team.query.get(team_id)
    player = Player.query.get(player_id)

    if not team or not player:
        return jsonify({'message': 'Team or player not found.'}), 404

    # Add player to team based on player type
    if player.playerType == 'Batter':
        team.batters.append(player)
    elif player.playerType == 'Pitcher':
        team.pitchers.append(player)

    # Add player to bench
    team.benchPlayers.append(player)
    player.active = False

    db.session.commit()

    updated_team = Team.query.options(joinedload(Team.batters), joinedload(Team.pitchers)).get(team_id)

    if updated_team:
        return jsonify({'message': 'Player drafted successfully.', 'team': updated_team.serialize(), 'player': player.serialize()}), 200
    else:
        return jsonify({'message': 'Error retrieving updated team.'}), 500

@draft_blueprint.route('/api/draft', methods=['POST'])
def draft():
    data = request.get_json()
    return draft_player(data['team_id'], data['player_id'])
#END OF draft.py