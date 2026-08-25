const { google } = require("googleapis");

/**
 * Google Sheets Authentication
 */

function createAuth() {
  // ==========================================
  // RENDER / ENVIRONMENT VARIABLES
  // ==========================================
  if (
    process.env.GOOGLE_CLIENT_EMAIL &&
    process.env.GOOGLE_PRIVATE_KEY
  ) {
    console.log("🔐 Using Google credentials from ENV");

    const privateKey =
      process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");

    return new google.auth.GoogleAuth({
      credentials: {
        client_email:
          process.env.GOOGLE_CLIENT_EMAIL,
        private_key: privateKey,
      },
      scopes: [
        "https://www.googleapis.com/auth/spreadsheets",
      ],
    });
  }

  // ==========================================
  // LOCAL DEVELOPMENT
  // ==========================================
  if (
    process.env.GOOGLE_APPLICATION_CREDENTIALS
  ) {
    console.log(
      "🔐 Using Google service-account JSON file"
    );

    return new google.auth.GoogleAuth({
      keyFile:
        process.env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes: [
        "https://www.googleapis.com/auth/spreadsheets",
      ],
    });
  }

  throw new Error(
    "Google Sheets credentials are not configured."
  );
}

// ==========================================
// GOOGLE SHEETS CLIENT
// ==========================================

const auth = createAuth();

const sheets = google.sheets({
  version: "v4",
  auth,
});

// ==========================================
// SAVE RESEARCH
// ==========================================

async function saveResearchToSheet(report) {
  try {
    console.log(
      "\n================ GOOGLE SHEETS START ================"
    );

    const spreadsheetId =
      process.env.GOOGLE_SHEET_ID;

    if (!spreadsheetId) {
      throw new Error(
        "GOOGLE_SHEET_ID is missing."
      );
    }

    const candidates =
      Array.isArray(report?.candidateCompanies)
        ? report.candidateCompanies
        : [];

    console.log(
      "Candidates to save:",
      candidates.length
    );

    if (candidates.length === 0) {
      console.warn(
        "⚠️ No candidate companies to save."
      );

      return {
        success: true,
        candidatesSaved: 0,
      };
    }

    const headers = [
      "Rank",
      "Company",
      "Website",
      "Industry",
      "Score",
      "Priority",
      "Reason",
    ];

    const rows = candidates.map(
      (company, index) => [
        company?.rank || index + 1,
        company?.name || "",
        company?.website || "",
        company?.industry || "",
        company?.score ?? "",
        company?.priority || "",
        company?.reason || "",
      ]
    );

    console.log(
      "Clearing previous Google Sheet data..."
    );

    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: "Sheet1!A:G",
    });

    console.log(
      "Writing candidates to Google Sheets..."
    );

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "Sheet1!A1",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          headers,
          ...rows,
        ],
      },
    });

    console.log(
      `✅ Google Sheets saved: ${rows.length} candidates`
    );

    console.log(
      "====================================================\n"
    );

    return {
      success: true,
      candidatesSaved: rows.length,
    };
  } catch (error) {
    console.error(
      "\n❌ GOOGLE SHEETS ERROR"
    );

    console.error(
      "Message:",
      error.message
    );

    console.error(
      "====================================================\n"
    );

    throw error;
  }
}

module.exports = {
  saveResearchToSheet,
};