from flask import Flask, jsonify
import csv

app = Flask(__name__)

@app.route('/api/players', methods=['GET'])
def get_players():
    players = []
    with open('./assets/PlayerDatabase.csv', 'r') as file:
        reader = csv.DictReader(file)
        for row in reader:
            players.append(row)
    return jsonify(players)
