/**
 * Tests for the pebble's visibility gate.
 * Run: node tests/extension/pebble-gate.test.mjs
 *
 * The bug this guards against: the gate short-circuited on "no change", so a
 * frame with NO composer never had its host hidden — leaving a stray button.
 * 1688 runs the script in three frames (shell, core chat, insights), so a
 * broken gate shows duplicate buttons.
 */

let pass = 0, fail = 0;
function check(label, ok, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${label}`); }
  else { fail++; console.log(`  [FAIL] ${label}${detail ? " — " + detail : ""}`); }
}

/**
 * The gate exactly as it appears in pebble.js, extracted so it can be tested
 * without a browser. Kept in sync deliberately: if the source changes shape,
 * `checkSourceShape` below fails loudly.
 */
function makeGate({ hasComposer, host, onHide }) {
  let shown = null;
  return function updateVisibility() {
    let present = false;
    try {
      present = hasComposer();
    } catch {
      present = false;
    }
    if (present === shown) return;
    shown = present;
    host.style.display = present ? "" : "none";
    if (!present) onHide();
  };
}

console.log("1) frame WITH a composer => button shown");
{
  const host = { style: { display: "none" } };
  const gate = makeGate({ hasComposer: () => true, host, onHide: () => {} });
  gate();
  check("display cleared to show", host.style.display === "");
}

console.log("\n2) frame WITHOUT a composer => button hidden (the regression)");
{
  const host = { style: { display: "" } };  // as if build() had shown it
  const gate = makeGate({ hasComposer: () => false, host, onHide: () => {} });
  gate();
  check("display set to none", host.style.display === "none",
    "an early return here left a stray button on the shell iframe");
}

console.log("\n3) composer appears later => button shows");
{
  let present = false;
  const host = { style: { display: "none" } };
  const gate = makeGate({ hasComposer: () => present, host, onHide: () => {} });
  gate();
  check("still hidden", host.style.display === "none");
  present = true;
  gate();
  check("now shown once the composer renders", host.style.display === "");
}

console.log("\n4) composer disappears => button hides and the pebble closes");
{
  let present = true;
  let closed = 0;
  const host = { style: { display: "" } };
  const gate = makeGate({ hasComposer: () => present, host, onHide: () => closed++ });
  gate();
  present = false;
  gate();
  check("hidden again", host.style.display === "none");
  check("pebble closed once", closed === 1, `${closed}`);
  gate();  // no change; must not re-fire
  check("no redundant close calls", closed === 1, `${closed}`);
}

console.log("\n5) a throwing hasComposer is treated as 'no composer'");
{
  const host = { style: { display: "" } };
  const gate = makeGate({
    hasComposer: () => { throw new Error("boom"); },
    host, onHide: () => {},
  });
  gate();
  check("hidden, no exception escapes", host.style.display === "none");
}

console.log("\n6) source shape: pebble.js still starts hidden and shown=null");
{
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(
    path.join(import.meta.dirname, "../../extension/content/pebble.js"), "utf8");
  check("host starts display:none", /position:static;display:none/.test(src),
    "without this a stray button flashes before the first gate pass");
  check("shown initialised to null", /let shown = null/.test(src),
    "false makes the first pass short-circuit on a composer-less frame");
  check("gate sets display from present", /host\.style\.display = present \? "" : "none"/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
