const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const DATABASE_ID = process.env.CF_DATABASE_ID;
const API_TOKEN = process.env.CF_API_TOKEN;

async function queryD1(sql, params = []) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    },
  );

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
