"""empty message

Revision ID: 757a5cbbcbef
Revises: 9c6f5d6bb3a7
Create Date: 2023-05-29 03:59:49.644883

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '757a5cbbcbef'
down_revision = '9c6f5d6bb3a7'
branch_labels = None
depends_on = None


def upgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    with op.batch_alter_table('games', schema=None) as batch_op:
        batch_op.add_column(sa.Column('home_team_lineup_position', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('away_team_lineup_position', sa.Integer(), nullable=True))

    # ### end Alembic commands ###


def downgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    with op.batch_alter_table('games', schema=None) as batch_op:
        batch_op.drop_column('away_team_lineup_position')
        batch_op.drop_column('home_team_lineup_position')

    # ### end Alembic commands ###
