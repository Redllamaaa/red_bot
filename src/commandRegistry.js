const FUN_API_TIMEOUT_MS = 8000;
const MAX_ANIMAL_IMAGE_BYTES = 8 * 1024 * 1024;

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
async function fetchAnimal(animal) {
  const data = await fetchJson(
    `https://api.some-random-api.com/animal/${animal}`,
    animal,
  );
  if (typeof data?.image !== "string" || typeof data?.fact !== "string") {
    throw new Error(`${animal} API returned an unexpected response shape`);
  }

  const imageUrl = new URL(data.image);
  if (imageUrl.protocol !== "https:" || imageUrl.hostname !== "i.imgur.com") {
    throw new Error(`${animal} API returned an unsupported image URL`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FUN_API_TIMEOUT_MS);
  try {
    const response = await fetch(imageUrl, {
      signal: controller.signal,
      redirect: "error",
    });
    if (!response.ok) throw new Error(`${animal} image returned ${response.status}`);
    const mime = response.headers.get("content-type")?.split(";")[0];
    const extension = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/gif": "gif",
      "image/webp": "webp",
    }[mime];
    const length = Number(response.headers.get("content-length"));
    if (!extension || (length && length > MAX_ANIMAL_IMAGE_BYTES)) {
      throw new Error(`${animal} image had an unsupported type or size`);
    }
    const attachment = Buffer.from(await response.arrayBuffer());
    if (attachment.length > MAX_ANIMAL_IMAGE_BYTES) {
      throw new Error(`${animal} image exceeded the size limit`);
    }
    return {
      text: data.fact,
      image: { attachment, name: `animal.${extension}` },
    };
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`${animal} image timed out`);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export const commandRegistry = {
  compliment: () => fetchFunApi("compliment"),
  fortune: () => fetchFunApi("fortune"),
  funfact: () => fetchFunApi("funfact"),
  pizzaidea: () => fetchFunApi("pizzaidea"),
  lifetruth: () => fetchFunApi("lifetruth"),
  thought: () => fetchFunApi("thought"),
  fox: () => fetchAnimal("fox"),
  cat: () => fetchAnimal("cat"),
  birb: () => fetchAnimal("birb"),
  panda: () => fetchAnimal("panda"),
  red_panda: () => fetchAnimal("red_panda"),
  raccoon: () => fetchAnimal("raccoon"),
  koala: () => fetchAnimal("koala"),
  kangaroo: () => fetchAnimal("kangaroo"),
  whale: () => fetchAnimal("whale"),
  dog: () => fetchAnimal("dog"),
  bird: () => fetchAnimal("bird"),
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
