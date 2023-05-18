# draft.py
from models import Player, Team, Game
from flask import jsonify
from database import db

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

    return jsonify({'message': 'Player drafted successfully.'}), 200
#END OF draft.py