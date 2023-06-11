# wsgi.py
from flask_socketio import SocketIO
from app import create_app
from my_socketio import setup_socketio_events  # Import this
from socketio_instance import socketio  # Import this
import logging

logging.basicConfig(filename='wsgi.log', level=logging.DEBUG)

app = create_app(socketio)

setup_socketio_events(socketio)

if __name__ == "__main__":
    logging.info('WSGI starting')
    socketio.run(app, host='0.0.0.0', port=5000)
#END OF wsgi.py