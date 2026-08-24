const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const DATABASE_ID = process.env.CF_DATABASE_ID;
const API_TOKEN = process.env.CF_API_TOKEN;

const D1_TIMEOUT_MS = 30000;

async function queryD1(sql, params = []) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), D1_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sql, params }),
        signal: controller.signal,
      },
    );
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`D1 request timed out after ${D1_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    // Non-2xx responses (rate limits, outages, auth failures) don't
    // reliably come back as the { success, errors } JSON shape below —
    // sometimes it's an HTML error page. Surface the HTTP status clearly
    // instead of letting response.json() throw an opaque parse error.
    let bodyText = "";
    try {
      bodyText = await response.text();
    } catch {
      // ignore — best effort
    }
    throw new Error(
      `D1 request failed with status ${response.status}${bodyText ? `: ${bodyText.slice(0, 200)}` : ""}`,
    );
  }

  const data = await response.json();
  if (!data.success) {
    throw new Error(data.errors?.[0]?.message || "D1 Query Failed");
  }

  return data.result[0];
}

export const db = {
  prepare(sql) {
    return {
      bind(...params) {
        return {
          async run() {
            return await queryD1(sql, params);
          },
          async all() {
            const res = await queryD1(sql, params);
            return { results: res.results || [] };
          },
        };
      },
      async all() {
        const res = await queryD1(sql, []);
        return { results: res.results || [] };
      },
      async run() {
        return await queryD1(sql, []);
      },
    };
  },
};
