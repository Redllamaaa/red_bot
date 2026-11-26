import test from "node:test";
import assert from "node:assert/strict";
import { computeNextEligible } from "../src/scheduling.js";
import {
  birthdayOccursOn,
  processBirthday,
} from "../src/birthdayProcessing.js";

test("monthly reminders keep their anchor at month end", () => {
  const next = computeNextEligible(
    { schedule_text: "every month", timezone: "UTC", monthly_anchor_day: 31 },
    new Date("2026-01-31T10:00:00.000Z"),
  );

  assert.equal(next.toISOString(), "2026-02-28T10:00:00.000Z");
});

test("random reminders choose an interval from one hour to one day", () => {
  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    assert.equal(
      computeNextEligible(
        { schedule_text: "random" },
        new Date("2026-01-01T00:00:00Z"),
      ).toISOString(),
      "2026-01-01T01:00:00.000Z",
    );
    Math.random = () => 0.999999;
    assert.equal(
      computeNextEligible(
        { schedule_text: "random" },
        new Date("2026-01-01T00:00:00Z"),
      ).toISOString(),
      "2026-01-02T00:00:00.000Z",
    );
  } finally {
    Math.random = originalRandom;
  }
});

test("Feb 29 birthdays run on Feb 28 in non-leap years and Feb 29 in leap years", () => {
  assert.equal(birthdayOccursOn(2, 29, new Date("2025-02-28T10:00:00Z")), true);
  assert.equal(
    birthdayOccursOn(2, 29, new Date("2024-02-28T10:00:00Z")),
    false,
  );
  assert.equal(birthdayOccursOn(2, 29, new Date("2024-02-29T10:00:00Z")), true);
  assert.equal(
    birthdayOccursOn(2, 29, new Date("2025-03-01T10:00:00Z")),
    false,
  );
});

test("birthday send succeeds but database marking fails", async () => {
  const calls = [];
  const originalError = console.error;
  console.error = () => {};
  try {
    await processBirthday(
      { id: "b1" },
      new Date("2026-02-28T10:00:00Z"),
      2026,
      async (birthday) => calls.push(`send:${birthday.id}`),
      async (year, updatedAt, id) => {
        calls.push(`mark:${year}:${updatedAt}:${id}`);
        throw new Error("database unavailable");
      },
    );
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(calls, ["send:b1", "mark:2026:2026-02-28T10:00:00.000Z:b1"]);
});
