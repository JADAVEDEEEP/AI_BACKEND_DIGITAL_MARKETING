const { GoogleGenAI } = require("@google/genai");
const masterPrompt = require("../prompts/masterPrompt");

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const generateCompanyReport = async ({
  agencyType,
  agencyServices,
  agencyRequirements,
}) => {
  try {
    console.log("\n================ AI RESEARCH START ================");
    console.log("Agency Type:", agencyType);
    console.log("Agency Services:", agencyServices);
    console.log("Agency Requirements:", agencyRequirements);

    const prompt = masterPrompt({
      agencyType,
      agencyServices,
      agencyRequirements,
    });

    console.log("Master Prompt Generated");
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

    console.log("Gemini Response Received");

    let text = response.text?.trim();

    if (!text) {
      throw new Error("Gemini returned an empty response.");
    }

    console.log("Response Length:", text.length);

    if (text.startsWith("```json")) {
      text = text.replace(/```json|```/g, "").trim();
    } else if (text.startsWith("```")) {
      text = text.replace(/```/g, "").trim();
    }

    const report = JSON.parse(text);

    console.log("JSON Parsed Successfully");
    console.log("================ AI RESEARCH END ================\n");

    return report;
  } catch (error) {
    console.error("\n❌ AI SERVICE ERROR");
    console.error("Status:", error.status);
    console.error("Message:", error.message);
    console.error("================================================\n");

    throw new Error(
      `Failed to generate lead research: ${error.message || error}`
    );
  }
};

module.exports = {
  generateCompanyReport,
};