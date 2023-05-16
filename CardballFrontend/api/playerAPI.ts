export const getPlayers = async () => {
    const response = await fetch('http://localhost:5000/api/players'); // replace with your server's address
    const players = await response.json();
    return players;
  };
  