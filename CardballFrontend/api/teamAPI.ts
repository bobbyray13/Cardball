// teamAPI.ts
export const createTeam = async (id: number, name: string) => {
    const response = await fetch('http://192.168.4.46:5000/api/teams', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id, name }),
    });
    const team = await response.json();
    return team;
};
//END OF teamAPI.ts
