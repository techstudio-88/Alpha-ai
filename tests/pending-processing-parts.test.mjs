import test from "node:test";
import assert from "node:assert/strict";
import {nextPendingPartStatus} from "../lib/pending-part-actions.mjs";

test("pending video parts can be approved or rejected exactly once",()=>{
  assert.equal(nextPendingPartStatus("pending","approve"),"approved");
  assert.equal(nextPendingPartStatus("pending","reject"),"declined");
  assert.equal(nextPendingPartStatus("approved","approve"),"approved");
  assert.equal(nextPendingPartStatus("declined","reject"),"declined");
  assert.throws(()=>nextPendingPartStatus("approved","reject"),/already been decided/);
  assert.throws(()=>nextPendingPartStatus("pending","cancel"),/Choose approve or reject/);
});
