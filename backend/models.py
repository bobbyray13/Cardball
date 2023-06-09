#models.py
from sqlalchemy import Column, Integer, String, ForeignKey, Boolean, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.inspection import inspect
from sqlalchemy.types import PickleType
from database import db
from datetime import datetime

class Serializer(object):

    def serialize(self):
        return {c: getattr(self, c) for c in inspect(self).attrs.keys()}

    @staticmethod
    def serialize_list(l):
        return [m.serialize() for m in l]

class Player(db.Model, Serializer):
    __tablename__ = 'players'

    id = Column(Integer, primary_key=True)
    name = Column(String(50), nullable=False)
    position = Column(String(30), nullable=False)
    bat_skill = Column(Integer)
    pow_skill = Column(Integer)
    pit_skill = Column(Integer)
    fld_skill = Column(Integer)
    run_skill = Column(Integer)
    playerType = Column(String, nullable=False)
    year = Column(Integer)
    status = Column(String(30), nullable=False, default='tbd')  # 'inLineupBatter', 'activePitcher', 'onBenchBatter', 'onBenchPitcher', 'tbd'
    role = Column(String)  # 'upToBat', 'upToPitch', 'upToSteal', 'upToDefend', 'onBase'
    drafted = Column(Boolean, default=False)

    __table_args__ = (db.UniqueConstraint('name', 'year', name='unique_name_and_year'),)

    team_id = Column(Integer, ForeignKey('teams.id'))
    team = relationship('Team', back_populates='players')

    def serialize(self):
        return {
            'id' : self.id,
            'name' : self.name,
            'position' : self.position,
            'bat_skill' : self.bat_skill,
            'pow_skill' : self.pow_skill,
            'pit_skill' : self.pit_skill,
            'fld_skill' : self.fld_skill,
            'run_skill' : self.run_skill,
            'playerType' : self.playerType,
            'year' : self.year,
            'status' : self.status,
            'role' : self.role,
            'team_id' : self.team_id,
            'team_name' : self.team.name if self.team else None,
            'drafted' : self.drafted
        }

class Team(db.Model, Serializer):
    __tablename__ = 'teams'

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), nullable=False)
    score = Column(Integer, default=0) #NOT USED ANYMORE, score kept in Gameplay. Need to migrate db"
    role = Column(String)  # 'onDefense' or 'onOffense'

    players = relationship('Player', lazy='dynamic')
    lineup = Column(PickleType) # List of integers between 1-9 indicating where in the lineup each player hits
    fieldPositions = Column(PickleType)  # Dictionary {position : Player id} both are strings

    # Relationships for different types of players
    batters = relationship('Player', primaryjoin="and_(Player.team_id==Team.id, Player.playerType=='Batter')", viewonly=True)
    pitchers = relationship('Player', primaryjoin="and_(Player.team_id==Team.id, Player.playerType=='Pitcher')", viewonly=True)
    bench_batters = relationship('Player', primaryjoin="and_(Player.team_id==Team.id, Player.status=='benchBatter')", viewonly=True)
    bench_pitchers = relationship('Player', primaryjoin="and_(Player.team_id==Team.id, Player.status=='benchPitcher')", viewonly=True)

    def serialize(self):
        return {
            'id' : self.id,
            'name' : self.name,
            'score' : self.score,
            'role' : self.role,
            'batters' : [player.serialize() for player in self.batters],
            'pitchers' : [player.serialize() for player in self.pitchers],
            'players' : [player.serialize() for player in self.players],
            'lineup' : self.lineup,
            'fieldPositions' : self.fieldPositions,
        }

class Game(db.Model, Serializer):
    __tablename__ = 'games'

    id = Column(Integer, primary_key=True)
    home_team_id = Column(Integer, ForeignKey('teams.id'))
    away_team_id = Column(Integer, ForeignKey('teams.id'))
    home_team = relationship('Team', backref='home_games', foreign_keys=[home_team_id])
    away_team = relationship('Team', backref='away_games', foreign_keys=[away_team_id])

    current_inning = Column(Integer, default=1)
    current_half = Column(String, default='top')  # 'top' or 'bottom'
    current_outs = Column(Integer, default=0)
        
    home_team_score = Column(Integer, default=0)
    away_team_score = Column(Integer, default=0)
    is_in_progress = Column(Boolean, default=True)
    start_time = Column(DateTime)
    end_time = Column(DateTime)

    lineup_position = Column(Integer, nullable=True)  # A player's position in the batting lineup (1-9, null if on bench)
    home_team_lineup_position = Column(Integer, default=1) # Current position in the batting lineup for home team
    away_team_lineup_position = Column(Integer, default=1) # Current position in the batting lineup for away team
    field_position = Column(String(30), nullable=True)  # Position on the field (C, 1B, 2B, 3B, SS, LF, CF, RF, DH, BN, P, BP)

    #Relatioships between Game and Team
    home_team_id = db.Column(db.Integer, db.ForeignKey('teams.id'))
    home_team = db.relationship('Team', foreign_keys=[home_team_id])

    away_team_id = db.Column(db.Integer, db.ForeignKey('teams.id'))
    away_team = db.relationship('Team', foreign_keys=[away_team_id])

    def serialize(self):
        return {
            'id': self.id,
            'homeTeam': self.home_team.serialize() if self.home_team else None,
            'awayTeam': self.away_team.serialize() if self.away_team else None,
            'currentInning': self.current_inning,
            'currentHalf': self.current_half,
            'outs': self.current_outs,
            'homeTeamScore': self.home_team_score,
            'awayTeamScore': self.away_team_score,
            'isInProgress': self.is_in_progress,
            'startTime': self.start_time.isoformat() if self.start_time else None,
            'endTime': self.end_time.isoformat() if self.end_time else None,
            'bases': [base.serialize() for base in self.bases],
            'homeTeamLineupPosition': self.home_team_lineup_position,
            'awayTeamLineupPosition': self.away_team_lineup_position,
        }

class Base(db.Model, Serializer):
    __tablename__ = 'bases'

    id = Column(Integer, primary_key=True)
    base_number = Column(Integer, nullable=False) # 1, 2, or 3
    is_occupied = Column(Boolean, default=False)
    player_id = Column(Integer, ForeignKey('players.id'))
    player = relationship('Player')
    game_id = Column(Integer, ForeignKey('games.id'))
    game = relationship('Game', backref='bases')

    def serialize(self):
        return {
            'id' : self.id,
            'baseNumber' : self.base_number,
            'isOccupied' : self.is_occupied,
            'player' : self.player.serialize() if self.player else None,
            'gameId' : self.game_id
        }

class GameLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    game_id = db.Column(db.Integer, db.ForeignKey('games.id'), nullable=False)
    log_message = db.Column(db.String(500), nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
#END OF models.py




#team_players = Team.query.get(some_team_id).players - get all players from a team
#player_team = Player.query.get(some_player_id).team - get the team of a player