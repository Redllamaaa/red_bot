const FUN_API_TIMEOUT_MS = 8000;

async function fetchFunApi(endpoint) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FUN_API_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(`https://my-fun-api.onrender.com/${endpoint}`, {
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(
        `${endpoint} API timed out after ${FUN_API_TIMEOUT_MS}ms`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

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
    return { success: result };
  } catch (err) {
    console.error(`${commandName} fetch failed:`, err.message);
    return {
      error: `Couldn't fetch that right now, try again in a bit!`,
    };
  }
}
