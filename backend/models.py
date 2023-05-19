#models.py
from sqlalchemy import Column, Integer, String, ForeignKey, Boolean, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.inspection import inspect
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
    playerType = Column(String)
    year = Column(Integer)
    status = Column(String(30), nullable=False)  # 'inLineupBatter', 'activePitcher', 'onBenchBatter', 'onBenchPitcher'
    role = Column(String)  # 'upToBat', 'upToPitch', 'upToSteal', 'upToDefend', 'onBase'
    drafted = Column(Boolean, default=False)

    team_id = Column(Integer, ForeignKey('teams.id'))
    team_name = relationship('Team', back_populates='players')

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

    id = Column(Integer, primary_key=True)
    name = Column(String(50), nullable=False)
    score = Column(Integer, default=0)
    role = Column(String)  # 'onDefense' or 'onOffense'

    players = relationship('Player', backref='team', lazy='dynamic')
    game_id = Column(Integer, ForeignKey('games.id'))

    # Relationships for different types of players
    game = relationship('Game', back_populates='home_team', foreign_keys=[game_id])
    batters = relationship('Player', primaryjoin="and_(Player.team_id==Team.id, Player.playerType=='Batter')", viewonly=True)
    pitchers = relationship('Player', primaryjoin="and_(Player.team_id==Team.id, Player.playerType=='Pitcher')", viewonly=True)
    bench_batters = relationship('Player', primaryjoin="and_(Player.team_id==Team.id, Player.status=='benchBatter')", viewonly=True)
    bench_pitchers = relationship('Player', primaryjoin="and_(Player.team_id==Team.id, Player.status=='benchPitcher')", viewonly=True)

    #get all batters, pitchers, bench batters, and bench pitchers for a team:
    #team_batters = Team.query.get(some_team_id).batters
    #team_pitchers = Team.query.get(some_team_id).pitchers
    #team_bench_batters = Team.query.get(some_team_id).bench_batters
    #team_bench_pitchers = Team.query.get(some_team_id).bench_pitchers

    def serialize(self):
        return {
            'id' : self.id,
            'name' : self.name,
            'score' : self.score,
            'role' : self.role,
            'batters' : [player.serialize() for player in self.batters],
            'pitchers' : [player.serialize() for player in self.pitchers],
            'players' : [player.serialize() for player in self.players],
            'game_id' : self.game_id
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

    def serialize(self):
        return {
            'id': self.id,
            'homeTeam': self.home_team.serialize() if self.home_team else None,
            'awayTeam': self.away_team.serialize() if self.away_team else None,
            'current_inning': self.current_inning,
            'half': self.current_half,
            'outs': self.current_outs,
            'homeTeamScore': self.home_team_score,
            'awayTeamScore': self.away_team_score,
            'isInProgress': self.is_in_progress,
            'startTime': self.start_time.isoformat() if self.start_time else None,
            'endTime': self.end_time.isoformat() if self.end_time else None,
        }

#team_players = Team.query.get(some_team_id).players - get all players from a team
#player_team = Player.query.get(some_player_id).team - get the team of a player


class GameLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    game_id = db.Column(db.Integer, db.ForeignKey('games.id'), nullable=False)
    log_message = db.Column(db.String(500), nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
#END OF models.py