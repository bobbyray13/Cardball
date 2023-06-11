# socketio_instance.py
from flask_socketio import SocketIO

socketio = SocketIO(cors_allowed_origins="*")

# You don't need to set up the events here.
# You can still do that in your my_socketio.py module.
#END OF socketio_instance.py