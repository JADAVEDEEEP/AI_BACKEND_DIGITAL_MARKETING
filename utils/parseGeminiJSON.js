/**
 * Safely parse a Gemini JSON response.
 *
 * Extracted unchanged from Services/ai.service.js so that the legacy
 * /api/research flow and the discovery pipeline share one parser.
 * Additionally supports top-level JSON arrays (used by some discovery
 * prompts); object handling is identical to the original behaviour.
 */
function parseGeminiJSON(text) {
  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }

  text = text.trim();

  // Remove markdown code fences if Gemini adds them
  text = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const firstBrace = text.indexOf("{");
  const firstBracket = text.indexOf("[");

  // Prefer whichever JSON container appears first
  let open = "{";
  let close = "}";
  let start = firstBrace;

  if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
    open = "[";
    close = "]";
    start = firstBracket;
  }

  if (start === -1) {
    throw new Error(
      "Gemini response does not contain a valid JSON object."
    );
  }

  text = text.substring(start);

  let depth = 0;
  let inString = false;
  let escaped = false;
  let endIndex = -1;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === open) {
      depth++;
    }

    if (char === close) {
      depth--;

      if (depth === 0) {
        endIndex = i + 1;
        break;
      }
    }
  }

  if (endIndex === -1) {
    throw new Error("Gemini returned incomplete JSON.");
  }

  const cleanJson = text.substring(0, endIndex).trim();

  try {
    return JSON.parse(cleanJson);
  } catch (error) {
    console.error("JSON Parse Failed");
    console.error("Clean JSON:", cleanJson.substring(0, 2000));

    throw new Error(
      `Invalid JSON returned by Gemini: ${error.message}`
    );
  }
}

module.exports = { parseGeminiJSON };
