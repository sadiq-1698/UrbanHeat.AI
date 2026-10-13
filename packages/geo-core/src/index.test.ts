import { test } from "node:test";
import assert from "node:assert/strict";
import { PACKAGE_NAME } from "./index.js";

test("package exports its name", () => {
  assert.equal(PACKAGE_NAME, "@urbanheat/geo-core");
});
