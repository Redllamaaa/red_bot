const FUN_API_TIMEOUT_MS = 8000;

async function fetchJson(url, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FUN_API_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`${label} API returned ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`${label} API timed out after ${FUN_API_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFunApi(endpoint) {
  const data = await fetchJson(
    `https://my-fun-api.onrender.com/${endpoint}`,
    endpoint,
  );
  const values = data?.data ? Object.values(data.data) : [];
  if (!values.length) {
    throw new Error(`${endpoint} API returned an unexpected response shape`);
  }
  return values[0]; // grabs whichever field it returns
}

// Returns { text, image } instead of a plain string; runFunCommand knows
// how to handle both shapes.
async function fetchFoxImage() {
  const data = await fetchJson(
    "https://api.some-random-api.com/img/fox",
    "fox",
  );
  if (typeof data?.link !== "string") {
    throw new Error("fox API returned an unexpected response shape");
  }
  return { text: "Here's a fox for you! 🦊", image: data.link };

  console.log("fox link:", data.link);
}

export const commandRegistry = {
  compliment: () => fetchFunApi("compliment"),
  fortune: () => fetchFunApi("fortune"),
  funfact: () => fetchFunApi("funfact"),
  pizzaidea: () => fetchFunApi("pizzaidea"),
  lifetruth: () => fetchFunApi("lifetruth"),
  thought: () => fetchFunApi("thought"),
  fox: () => fetchFoxImage(),
};

export const commandChoices = Object.keys(commandRegistry).map((name) => ({
  name,
  value: name,
}));

/**
 * Runs a fun command by name and normalizes the result to { success } or
 * { error }. Both commands.js (interactive `/compliment` etc.) and
 * discord.js (a repeating reminder configured to run a command) need this
 * exact "call it, catch it, log it, give the user a friendly message"
 * behavior — this is the one place that owns it.
 */
export async function runFunCommand(commandName) {
  const fn = commandRegistry[commandName];
  if (!fn) {
    return { error: `Unknown command \`${commandName}\`.` };
  }
  try {
    const result = await fn();
    if (result && typeof result === "object") {
      return { success: result.text, image: result.image };
    }
    return { success: result };
  } catch (err) {
    console.error(`${commandName} fetch failed:`, err.message);
    return {
      error: `Couldn't fetch that right now, try again in a bit!`,
    };
  }
}
