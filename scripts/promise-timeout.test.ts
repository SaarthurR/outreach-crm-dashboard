import assert from "node:assert/strict";
import { test } from "node:test";

import { TimeoutError, withTimeout } from "./promise-timeout.js";

test("withTimeout returns the promise value when it settles in time", async () => {
  const result = await withTimeout(Promise.resolve("ok"), 50, "fast task");
  assert.equal(result, "ok");
});

test("withTimeout rejects with TimeoutError when the promise never settles", async () => {
  await assert.rejects(
    withTimeout(new Promise(() => undefined), 10, "stalled task"),
    (error: unknown) =>
      error instanceof TimeoutError &&
      (error as TimeoutError).message === "stalled task timed out after 10ms",
  );
});

test("withTimeout runs the timeout callback before rejecting", async () => {
  let timedOut = false;

  await assert.rejects(
    withTimeout(new Promise(() => undefined), 10, "abortable task", () => {
      timedOut = true;
    }),
    TimeoutError,
  );

  assert.equal(timedOut, true);
});
