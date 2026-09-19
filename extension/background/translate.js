/**
 * Batch prompt construction and response parsing.
 *
 * The model is asked for numbered lines rather than a custom delimiter: it
 * follows numbering far more reliably, and a numbered line is easy to match
 * even when the model adds stray prose around the result.
 */

/** How many segments to send in one request. */
export const BATCH_SIZE = 25;

/** Rough character budget per batch, so one huge segment cannot blow the context. */
export const BATCH_CHAR_BUDGET = 6000;

/** Characters that indicate a string is worth translating. */
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

export function hasChinese(text) {
  return typeof text === "string" && CJK.test(text);
}

/**
 * Build the instruction. Numbering starts at 1 and is preserved in the output.
 */
export function buildPrompt(segments, target = "English") {
  const body = segments.map((s, i) => `${i + 1}. ${s}`).join("\n");
  return (
    `Translate each numbered segment into ${target}. ` +
    `Keep the same numbering. Output ONLY the numbered translations, ` +
    `one per line, with no explanation, no notes and no original text.\n\n` +
    body
  );
}

/**
 * Parse a numbered response back into an array aligned with the input.
 *
 * Returns an array of the same length; entries the model failed to return are
 * `null` so the caller can retry or leave the original text in place. Never
 * returns partial garbage: a line that does not match the numbering is ignored.
 */
export function parseBatch(response, count) {
  const out = new Array(count).fill(null);
  if (typeof response !== "string") return out;

  const line = /^\s*(\d{1,3})\s*[.):\-]?\s+(.+?)\s*$/;
  // Some models emit the numbering twice ("1. 1. text"); strip a leading
  // repeat so the translation does not carry stray digits.
  const doubled = /^\s*\d{1,3}\s*[.):\-]\s+(.*)$/;

  for (const raw of response.split("\n")) {
    const m = raw.match(line);
    if (!m) continue;
    const idx = Number(m[1]) - 1;
    if (idx < 0 || idx >= count) continue;
    let value = m[2].trim();
    const inner = value.match(doubled);
    if (inner) value = inner[1].trim();
    if (!value) continue;
    // Guard against the model echoing the numbering back with no translation.
    if (out[idx] === null) out[idx] = value;
  }
  return out;
}

/**
 * Split a list of strings into batches respecting both count and character
 * budget. Oversized single segments get their own batch rather than being
 * dropped.
 */
export function makeBatches(items) {
  const batches = [];
  let current = [];
  let chars = 0;

  for (const item of items) {
    const len = item.length;
    const wouldOverflow =
      current.length >= BATCH_SIZE || chars + len > BATCH_CHAR_BUDGET;

    if (wouldOverflow && current.length > 0) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(item);
    chars += len;
  }
  if (current.length) batches.push(current);
  return batches;
}
