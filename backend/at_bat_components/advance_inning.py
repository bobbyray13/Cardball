# from models import Game
# from sqlalchemy.orm import Session
# from database import db

# class AdvanceInning:
#     def __init__(self, game: Game, db):
#         self.game = game

#     def advance(self):
#         # Switch roles of home and away teams
#         if self.game.home_team.role == 'onDefense':
#             self.game.home_team.role = 'onOffense'
#             self.game.away_team.role = 'onDefense'
#             self.game.current_half = 'bottom'
#         else:
#             self.game.home_team.role = 'onDefense'
#             self.game.away_team.role = 'onOffense'
#             self.game.current_half = 'top'
#             self.game.current_inning += 1

#         # Save changes to the database
#         db.session.commit()


#POSSIBLY DELETE WHOLE FILE
