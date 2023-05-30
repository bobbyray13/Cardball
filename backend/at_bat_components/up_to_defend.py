import random
from sqlalchemy.orm import Session
from ..models import Player, Team, Game, Base  # Import your models

class UpToDefend:
    def __init__(self, game: Game, session: Session):
        self.game = game
        self.session = session

    def get_defensive_team(self):
        return self.game.home_team if self.game.home_team.role == "onDefense" else self.game.away_team

    def determine_up_to_defend_based_on_roll(self, direction_roll: int, power_roll: int):
        possible_positions = []

        if direction_roll == 1:
            possible_positions = ["3B", "LF"]
        elif direction_roll == 2:
            possible_positions = ["SS", "3B", "LF", "CF"]
        elif direction_roll == 3:
            possible_positions = ["SS", "CF"]
        elif direction_roll == 4:
            possible_positions = ["2B", "CF"]
        elif direction_roll == 5:
            possible_positions = ["2B", "1B", "CF", "RF"]
        elif direction_roll == 6:
            possible_positions = ["1B", "RF"]

        # Adjust possible positions based on power roll
        if power_roll >= 11:
            possible_positions = ["LF", "CF", "RF"]
        elif power_roll <= 10:
            possible_positions = ["3B", "SS", "2B", "1B"]

        # Retrieve the defensive team
        defensive_team = self.get_defensive_team()

        # Get players that are in the possible positions
        possible_players = []
        for position, player_id in defensive_team.fieldPositions.items():
            if position in possible_positions:
                player = self.session.query(Player).get(player_id)
                if player:
                    possible_players.append(player)

        # If no possible players, return None
        if not possible_players:
            print("Error: No possible players to defend.")
            return None

        # Sort the players based on their fld_skill and select the one with highest fld_skill
        possible_players.sort(key=lambda x: x.fld_skill, reverse=True)

        highest_fld_skill = possible_players[0].fld_skill

        # Filter out players who don't have the highest fld_skill
        possible_players = [player for player in possible_players if player.fld_skill == highest_fld_skill]

        # Choose a random player among those with the highest fld_skill
        up_to_defend = random.choice(possible_players)

        return up_to_defend
