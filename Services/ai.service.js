const { GoogleGenAI } = require("@google/genai");

const {
  candidatePrompt,
  finalResearchPrompt,
} = require("../prompts/masterPrompt");

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

/**
 * Safely parse Gemini JSON response.
 */
function parseGeminiJSON(text) {
  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }

  text = text.trim();

  // Remove markdown fences if Gemini adds them
  text = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // Find first JSON object
  const firstBrace = text.indexOf("{");

  if (firstBrace === -1) {
    throw new Error(
      "Gemini response does not contain a valid JSON object."
    );
  }

  text = text.substring(firstBrace);

  // Find the end of the first complete JSON object
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

    if (char === "{") {
      depth++;
    }

    if (char === "}") {
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
    console.error("Clean JSON:", cleanJson.substring(0, 1000));

    throw new Error(
      `Invalid JSON returned by Gemini: ${error.message}`
    );
  }
}


/**
 * Call Gemini.
 */
async function callGemini(prompt, stageName) {
  console.log(`\n================ ${stageName} ================`);
  console.log("Prompt Length:", prompt.length);
  console.log("Sending Request to Gemini...");

  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-lite",
    contents: prompt,
    config: {
      temperature: 0.3,
      responseMimeType: "application/json",
    },
  });

  console.log(`${stageName} Response Received`);

  const text = response.text?.trim();

  if (!text) {
    throw new Error(
      `Gemini returned an empty response during ${stageName}.`
    );
  }

  console.log(`${stageName} Response Length:`, text.length);

  const parsed = parseGeminiJSON(text);

  console.log(`${stageName} JSON Parsed Successfully`);

  return parsed;
}


/**
 * Main research function
 *
 * Stage 1:
 * Discover 100 candidates
 *
 * Stage 2:
 * Evaluate candidates and generate final research
 */
const generateCompanyReport = async ({
  agencyType,
  agencyServices,
  agencyRequirements,
}) => {
  try {
    console.log(
      "\n=================================================="
    );

    console.log(
      "          AI DIGITAL MARKETING RESEARCH"
    );

    console.log(
      "=================================================="
    );

    console.log("Agency Type:", agencyType);
    console.log("Agency Services:", agencyServices);
    console.log("Agency Requirements:", agencyRequirements);


    // ==================================================
    // STAGE 1 — CANDIDATE DISCOVERY
    // ==================================================

    console.log(
      "\n\n================ STAGE 1 START ================"
    );

    const stage1Prompt = candidatePrompt({
      agencyType,
      agencyServices,
      agencyRequirements,
    });

    const candidateResult = await callGemini(
      stage1Prompt,
      "STAGE 1 — CANDIDATE DISCOVERY"
    );

    const candidates = Array.isArray(
      candidateResult?.candidateCompanies
    )
      ? candidateResult.candidateCompanies
      : [];

    console.log(
      "Candidates Received:",
      candidates.length
    );

    if (candidates.length === 0) {
      throw new Error(
        "Stage 1 failed: No candidate companies returned."
      );
    }

    // Warn instead of failing if Gemini returns less than 100.
    if (candidates.length < 100) {
      console.warn(
        `⚠️ Stage 1 returned ${candidates.length} candidates instead of 100.`
      );
    }

    // Remove duplicate companies by name
    const uniqueCandidates = [];

    const seenCompanies = new Set();

    for (const company of candidates) {
      const key = String(
        company?.name || ""
      )
        .trim()
        .toLowerCase();

      if (!key) continue;

      if (seenCompanies.has(key)) {
        continue;
      }

      seenCompanies.add(key);
      uniqueCandidates.push(company);
    }

    console.log(
      "Unique Candidates:",
      uniqueCandidates.length
    );

    if (uniqueCandidates.length === 0) {
      throw new Error(
        "Stage 1 returned invalid candidate data."
      );
    }


    // ==================================================
    // STAGE 2 — FINAL RESEARCH
    // ==================================================

    console.log(
      "\n\n================ STAGE 2 START ================"
    );

    console.log(
      "Sending",
      uniqueCandidates.length,
      "candidates to Stage 2..."
    );

    const stage2Prompt = finalResearchPrompt({
      agencyType,
      agencyServices,
      agencyRequirements,
      candidates: uniqueCandidates,
    });

    const finalResult = await callGemini(
      stage2Prompt,
      "STAGE 2 — FINAL RESEARCH"
    );


    // ==================================================
    // COMBINE STAGE 1 + STAGE 2
    // ==================================================

    const report = {
      ...finalResult,

      // Keep the complete candidate pool
      candidateCompanies: uniqueCandidates,

      // Preserve agency analysis from stage 1
      agencyAnalysis:
        finalResult?.agencyAnalysis ||
        candidateResult?.agencyAnalysis ||
        {
          agencyType,
          services: agencyServices,
          requirements: agencyRequirements,
          evaluationCriteria: [],
        },
    };


    // ==================================================
    // FINAL VALIDATION
    // ==================================================

    console.log(
      "\n================ FINAL RESULT ================"
    );

    console.log(
      "Candidate Companies:",
      report?.candidateCompanies?.length || 0
    );

    console.log(
      "Recommended Company:",
      report?.recommendedCompany?.name ||
        report?.topCompany?.name ||
        "N/A"
    );

    console.log(
      "Competitive Companies:",
      report?.competitiveCompanies?.length || 0
    );

    console.log(
      "Final Companies:",
      report?.finalCompanies?.length || 0
    );

    console.log(
      "Sources:",
      report?.sources?.length || 0
    );

    console.log(
      "================================================\n"
    );

    return report;

  } catch (error) {

    console.error(
      "\n❌ AI SERVICE ERROR"
    );

    console.error(
      "Status:",
      error.status
    );

    console.error(
      "Message:",
      error.message
    );

    console.error(
      "================================================\n"
    );

    throw new Error(
      `Failed to generate lead research: ${
        error.message || error
      }`
    );
  }
};


module.exports = {
  generateCompanyReport,
};