const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const DATABASE_ID = process.env.CF_DATABASE_ID;
const API_TOKEN = process.env.CF_API_TOKEN;

const D1_TIMEOUT_MS = 30000;
const D1_MAX_RETRIES = 3;

async function queryD1(sql, params = []) {
  for (let attempt = 1; attempt <= D1_MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), D1_TIMEOUT_MS);

    try {
      const response = await fetch(
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

      if (!response.ok) {
        let bodyText = "";

        try {
          bodyText = await response.text();
        } catch {
          // Best effort.
        }

        throw new Error(
          `D1 request failed with status ${response.status}${
            bodyText ? `: ${bodyText.slice(0, 200)}` : ""
          }`,
        );
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.errors?.[0]?.message || "D1 Query Failed");
      }

      return data.result[0];
    } catch (err) {
      const isTimeout = err.name === "AbortError";
      const isLastAttempt = attempt === D1_MAX_RETRIES;

      if (isLastAttempt) {
        if (isTimeout) {
          throw new Error(
            `D1 request timed out after ${D1_TIMEOUT_MS}ms (${D1_MAX_RETRIES} attempts)`,
          );
        }

        throw err;
      }

      const delay = attempt * 1000;

      console.warn(
        `D1 request failed (attempt ${attempt}/${D1_MAX_RETRIES}), retrying in ${delay}ms:`,
        err.message,
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    } finally {
      clearTimeout(timeout);
    }
  }
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
