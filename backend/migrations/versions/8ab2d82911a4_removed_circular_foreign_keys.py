"""removed circular foreign keys

Revision ID: 8ab2d82911a4
Revises: 
Create Date: 2023-05-18 21:49:16.620881

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '8ab2d82911a4'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    op.create_table('teams',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=50), nullable=False),
    sa.Column('score', sa.Integer(), nullable=True),
    sa.Column('role', sa.String(), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('games',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('home_team_id', sa.Integer(), nullable=True),
    sa.Column('away_team_id', sa.Integer(), nullable=True),
    sa.Column('current_inning', sa.Integer(), nullable=True),
    sa.Column('current_half', sa.String(), nullable=True),
    sa.Column('current_outs', sa.Integer(), nullable=True),
    sa.Column('home_team_score', sa.Integer(), nullable=True),
    sa.Column('away_team_score', sa.Integer(), nullable=True),
    sa.Column('is_in_progress', sa.Boolean(), nullable=True),
    sa.Column('start_time', sa.DateTime(), nullable=True),
    sa.Column('end_time', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['away_team_id'], ['teams.id'], ),
    sa.ForeignKeyConstraint(['home_team_id'], ['teams.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('players',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=50), nullable=False),
    sa.Column('position', sa.String(length=30), nullable=False),
    sa.Column('bat_skill', sa.Integer(), nullable=True),
    sa.Column('pow_skill', sa.Integer(), nullable=True),
    sa.Column('pit_skill', sa.Integer(), nullable=True),
    sa.Column('fld_skill', sa.Integer(), nullable=True),
    sa.Column('run_skill', sa.Integer(), nullable=True),
    sa.Column('playerType', sa.String(), nullable=True),
    sa.Column('year', sa.Integer(), nullable=True),
    sa.Column('status', sa.String(length=30), nullable=False),
    sa.Column('role', sa.String(), nullable=True),
    sa.Column('drafted', sa.Boolean(), nullable=True),
    sa.Column('team_id', sa.Integer(), nullable=True),
    sa.ForeignKeyConstraint(['team_id'], ['teams.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('game_log',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('game_id', sa.Integer(), nullable=False),
    sa.Column('log_message', sa.String(length=500), nullable=False),
    sa.Column('timestamp', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['game_id'], ['games.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    # ### end Alembic commands ###


def downgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_table('game_log')
    op.drop_table('players')
    op.drop_table('games')
    op.drop_table('teams')
    # ### end Alembic commands ###
