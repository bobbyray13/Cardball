import random

def roll_dice(sides, modifier=0):
    """Roll a dice with the specified number of sides and add a modifier."""
    return random.randint(1, sides) + modifier

def pitch_roll(pitcher):
    return roll_dice(6, pitcher.pit_skill)

def swing_roll(batter):
    return roll_dice(6, batter.bat_skill)

def contact_roll(batter):
    power_roll = roll_dice(20, batter.pow_skill)
    direction_roll = roll_dice(6)
    return power_roll, direction_roll

def throw_roll(defender):
    return roll_dice(20, defender.fld_skill)
