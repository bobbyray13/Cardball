#up_to_defend.py
import random
from sqlalchemy.orm import Session
from models import Player, Team, Game, Base
from database import db

class UpToDefend:
    def __init__(self, game: Game, db):
        self.game = game

    def get_defensive_team(self):
        return self.game.home_team if self.game.home_team.role == "onDefense" else self.game.away_team

    def determine_up_to_defend_based_on_roll(self, direction_roll: int, power_roll: int):
        direction_positions = []

        if direction_roll == 1:
            direction_positions = ["3B", "LF"]
        elif direction_roll == 2:
            direction_positions = ["SS", "3B", "LF", "CF"]
        elif direction_roll == 3:
            direction_positions = ["SS", "CF"]
        elif direction_roll == 4:
            direction_positions = ["2B", "CF"]
        elif direction_roll == 5:
            direction_positions = ["2B", "1B", "CF", "RF"]
        elif direction_roll == 6:
            direction_positions = ["1B", "RF"]

        power_positions = []

        if power_roll >= 11:
            power_positions = ["LF", "CF", "RF"]
        elif power_roll <= 10:
            power_positions = ["3B", "SS", "2B", "1B"]

        # Find the intersection of direction_positions and power_positions
        possible_positions = list(set(direction_positions) & set(power_positions))

        print(f"possible_positions: {possible_positions}")

        # Retrieve the defensive team
        defensive_team = self.get_defensive_team()

        print(f"defensive_team.fieldPositions: {defensive_team.fieldPositions}")

        # Get players that are in the possible positions
        possible_players = []
        for position, player_id in defensive_team.fieldPositions.items():
            if position in possible_positions:
                player = db.session.query(Player).get(player_id)
                if player:
                    possible_players.append(player)
                
        print(f"possible_players: {possible_players}")

        # If no possible players, select the player with the best fielding skill
        if not possible_players:
            print("Warning: No possible players to defend based on the direction and power roll.")
            print("Selecting the player with the best fielding skill.")
            all_players = [db.session.query(Player).get(player_id) for _, player_id in defensive_team.fieldPositions.items()]
            all_players.sort(key=lambda x: x.fld_skill, reverse=True)
            possible_players.append(all_players[0])

        # Sort the players based on their fld_skill and select the one with highest fld_skill
        possible_players.sort(key=lambda x: x.fld_skill, reverse=True)

        highest_fld_skill = possible_players[0].fld_skill

        # Filter out players who don't have the highest fld_skill
        possible_players = [player for player in possible_players if player.fld_skill == highest_fld_skill]

        # Choose a random player among those with the highest fld_skill
        up_to_defend = random.choice(possible_players)

        return up_to_defend

#END OF up_to_defend.py