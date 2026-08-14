async function fetchFunApi(endpoint) {
  const res = await fetch(`https://my-fun-api.onrender.com/${endpoint}`);
  if (!res.ok) throw new Error(`${endpoint} API returned ${res.status}`);
  const data = await res.json();
  return Object.values(data.data)[0]; // grabs whichever field it returns
}

export const commandRegistry = {
  compliment: () => fetchFunApi("compliment"),
  fortune: () => fetchFunApi("fortune"),
  funfact: () => fetchFunApi("funfact"),
  pizzaidea: () => fetchFunApi("pizzaidea"),
  lifetruth: () => fetchFunApi("lifetruth"),
  thought: () => fetchFunApi("thought"),
};

export const commandChoices = Object.keys(commandRegistry).map((name) => ({
  name,
  value: name,
}));
