# Baseball Game

This is a text-based baseball game with a Python/Flask backend and a TypeScript/React Native frontend.

## Project Structure

### Backend

- `app.py`: Main Flask application file where the routes are defined.
- `models/`: Directory that contains model definitions for the database.
  - `player.py`: Defines the Player model.
  - `team.py`: Defines the Team model.
  - `inning.py`: Defines the Inning model.
  - `game.py`: Defines the Game model.
  - `atbat.py`: Defines the AtBat model.
- `controllers/`: Directory that contains the logic of the routes.
  - `player_controller.py`: Handles player-related actions (pitch roll, swing roll, etc.).
  - `team_controller.py`: Handles team-related actions (add run to score, substitute player, etc.).
  - `inning_controller.py`: Handles inning-related actions (increment outs, end half inning, etc.).
  - `game_controller.py`: Handles game-related actions (initialize game, check if game is over, etc.).
  - `atbat_controller.py`: Handles at-bat-related actions.
- `utils/`: Directory for helper functions and constants.
- `tests/`: Directory for unit tests.

### Frontend

- `App.tsx`: Main component of the application.
- `types.ts`: Defines types for data
- `components/`: Directory for reusable components.
  - `Player.tsx`: Component for displaying player information.
  - `Team.tsx`: Component for displaying team information.
  - `Inning.tsx`: Component for displaying inning information.
  - `Game.tsx`: Component for displaying the game state and user options.
  - `AtBat.tsx`: Component for displaying at-bat actions and outcomes.
- `screens/`: Directory for screen components.
  - `HomeScreen.tsx`: Home screen with game initialization options.
  - `GameScreen.tsx`: Screen for displaying the game.
  - `DraftScreen.tsx`: Screen for handling the draft.
- `api/`: Directory for functions to make API calls to the backend.
  - `playerApi.ts`: Functions for player-related API calls.
  - `teamApi.ts`: Functions for team-related API calls.
  - `inningApi.ts`: Functions for inning-related API calls.
  - `gameApi.ts`: Functions for game-related API calls.
  - `atBatApi.ts`: Functions for at-bat-related API calls.
- `contexts/`: Directory for React Contexts for state management.
  - `gameContext.tsx`: Context for managing the game state.
- `utils/`:
  - `utils.tsx`:
- `assets/`: Directory for static assets like images and fonts.
- `styles/`: Directory for global styles.
- `app.json`: 
- `package.json`: 
- `package-lock.json`: 
- `tsconfig.json`:
- `babel.config.js`:

## Getting Started


## Other Important Information

