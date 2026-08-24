

const { generateCompanyReport } = require("../Services/ai.service");

// Create Research Report
const createResearch = async (req, res) => {
  const startTime = Date.now();

  try {
    const {
      agencyType,
      agencyServices,
      agencyRequirements,
    } = req.body;

    if (!agencyType || !agencyServices || !agencyRequirements) {
      return res.status(400).json({
        success: false,
        message:
          "Agency type, services and requirements are required.",
      });
    }

    const aiReport = await generateCompanyReport({
      agencyType,
      agencyServices,
      agencyRequirements,
    });

    if (!aiReport) {
      return res.status(500).json({
        success: false,
        message: "Failed to generate research.",
      });
    }

    const responseTime = Date.now() - startTime;

    return res.status(200).json({
      success: true,
      message: "Lead research generated successfully.",
      data: aiReport,
      responseTime,
    });

  } catch (error) {
    console.error("Research Controller Error:", error);

    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
}

module.exports = {
  createResearch,
  
};