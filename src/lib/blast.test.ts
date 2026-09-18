import assert from "node:assert/strict";
import { test } from "node:test";

import { parseRecipients } from "./blast";

test("addresses are found whatever separator the paste used", () => {
  const { addresses } = parseRecipients(
    "a@one.com, b@two.com; c@three.com\nd@four.com e@five.io",
  );

  assert.deepEqual(addresses, [
    "a@one.com",
    "b@two.com",
    "c@three.com",
    "d@four.com",
    "e@five.io",
  ]);
});

test("a Gmail-style paste keeps the address and drops the display name", () => {
  const { addresses } = parseRecipients('Ada Lovelace <ada@example.com>, "Bob" <bob@example.com>');

  assert.deepEqual(addresses, ["ada@example.com", "bob@example.com"]);
});

test("duplicates are removed and counted, case and trailing punctuation ignored", () => {
  const { addresses, duplicates } = parseRecipients("Sam@Example.com, sam@example.com. sam@example.com");

  assert.deepEqual(addresses, ["sam@example.com"]);
  assert.equal(duplicates, 2);
});

test("text with no addresses yields nothing rather than throwing", () => {
  const { addresses, duplicates } = parseRecipients("no addresses here at all");

  assert.deepEqual(addresses, []);
  assert.equal(duplicates, 0);
});
