const candidatePrompt = ({
  agencyType,
  agencyServices,
  agencyRequirements,
}) => `

You are an expert B2B lead generation and market research analyst.

AGENCY TYPE:
${agencyType}

AGENCY SERVICES:
${agencyServices}

AGENCY REQUIREMENTS:
${agencyRequirements}

TASK:
Build a broad initial candidate pool of EXACTLY 100 real companies whenever possible.

IMPORTANT:
- Find 100 DIFFERENT real companies.
- Do not stop at 2, 5, 10, 20, 50 or 80.
- Do not deeply research candidates.
- Do not find competitors yet.
- Do not generate outreach.
- Do not generate marketing plans.
- Do not generate KPIs.
- Do not generate the 6 business outputs.
- This stage is ONLY candidate discovery.

Each candidate must have:

- rank
- name
- website
- industry
- score
- priority
- reason

Evaluate candidates using:

Agency / ICP Fit
Service Fit
Industry Relevance
Marketing Opportunity
Business Potential
Need / Pain Point
Buying Signals

The score is a PRELIMINARY score.

Priority:

80-100 = HOT
60-79 = WARM
40-59 = LOW PRIORITY
0-39 = POOR FIT

Rules:

- Real companies only.
- Do not invent companies.
- Do not duplicate companies.
- Do not use fake URLs.
- Prefer companies with genuine potential to purchase the agency services.
- Do not prefer companies merely because they are famous or large.
- Try to return exactly 100 candidates.
- If fewer than 100 genuinely relevant companies can be identified, return as many real companies as possible.
- Never fabricate companies to reach 100.

RETURN ONLY VALID JSON.

{
  "agencyAnalysis": {
    "agencyType": "",
    "services": [],
    "requirements": "",
    "idealCustomerProfile": "",
    "evaluationCriteria": [
      "Agency / ICP Fit",
      "Service Fit",
      "Industry Relevance",
      "Marketing Opportunity",
      "Business Potential",
      "Need / Pain Point",
      "Buying Signals"
    ]
  },

  "candidateCompanies": [
    {
      "rank": 1,
      "name": "",
      "website": "",
      "industry": "",
      "score": 0,
      "priority": "",
      "reason": ""
    }
  ]
}

FINAL REQUIREMENT:

candidateCompanies should contain 100 companies whenever 100 real relevant companies can reasonably be identified.

The response MUST contain only one JSON object.
No Markdown.
No explanation.
No code fences.
`;

const finalResearchPrompt = ({
  agencyType,
  agencyServices,
  agencyRequirements,
  candidates,
}) => `

You are an expert B2B Lead Generation, Digital Marketing and Business Research Analyst.

AGENCY INFORMATION

Agency Type:
${agencyType}

Agency Services:
${agencyServices}

Agency Requirements:
${agencyRequirements}

INITIAL CANDIDATE POOL

The following companies were discovered during the initial research stage:

${JSON.stringify(candidates, null, 2)}

IMPORTANT:

These candidates have already been discovered.

DO NOT search for another candidate pool.

DO NOT replace the candidate pool.

DO NOT invent companies.

Your job is now to:

1. Evaluate the candidate pool.
2. Filter poor-fit companies.
3. Select the strongest potential client.
4. Deeply research the selected company.
5. Find its strongest relevant competitors.
6. Deeply evaluate the selected company and competitors.
7. Create a final ranked list of up to 10 companies.
8. Generate the 6 business outputs ONLY for the #1 company.

==================================================
PRIMARY COMPANY SELECTION
==================================================

Select the company with the strongest combination of:

- Agency / ICP Fit
- Service Fit
- Marketing Opportunity
- Business Potential
- Need / Pain Point
- Buying Signals

Do not select a company simply because it is famous, large or highly funded.

==================================================
COMPETITOR RESEARCH
==================================================

Find up to 9 genuine relevant competitors of the selected company.

Competitors must:

- operate in the same or closely related industry
- target similar customers
- offer similar products/services
- be commercially relevant

Do not invent competitors.

==================================================
FINAL SCORING
==================================================

Score every deeply evaluated company from 0-100.

Use EXACTLY:

Agency / ICP Fit = 25
Service Fit = 20
Marketing Opportunity = 20
Business Potential = 15
Need / Pain Point = 10
Buying Signals = 10

TOTAL = 100

Priority:

80-100 = HOT
60-79 = WARM
40-59 = LOW PRIORITY
0-39 = POOR FIT

The breakdown MUST mathematically equal the final score.

==================================================
FINAL COMPANY INFORMATION
==================================================

For every final company provide:

- rank
- name
- website
- industry
- location
- businessModel
- companySize
- agencyFit
- serviceFit
- marketingOpportunity
- businessPotential
- identifiedNeed
- buyingSignals
- mainOpportunity
- score
- priority
- reason
- competitorRelation
- sources

competitorRelation MUST be:

"Primary Recommendation"
"Direct Competitor"
"Relevant Competitor"

==================================================
PRIMARY RECOMMENDATION
==================================================

For #1 provide:

- name
- website
- industry
- location
- score
- priority
- whyBestFit
- mainOpportunity
- recommendedService
- evidence

==================================================
6 BUSINESS OUTPUTS
==================================================

Generate these ONLY for #1:

1. Lead Generation
2. AI & Automation
3. Lead Scoring
4. Personalized Outreach
5. Digital Marketing
6. Results / KPIs

==================================================
LEAD GENERATION
==================================================

Provide:

- qualificationReason
- strategy
- informationToCollect
- decisionMakerRole
- tools

==================================================
AI & AUTOMATION
==================================================

Workflow:

Find Leads
→ Enrich Data
→ AI Research
→ Lead Scoring
→ Personalized Outreach
→ CRM
→ Follow Up

Recommend only useful tools.

==================================================
LEAD SCORING
==================================================

Provide:

- finalScore
- breakdown
- strengths
- weaknesses
- priority
- reason

finalScore MUST equal the actual company score.

==================================================
PERSONALIZED OUTREACH
==================================================

Create one personalized cold email.

The email must:

- mention the company
- mention a real opportunity
- connect it to the agency service
- provide value
- include CTA
- avoid generic sales language
- avoid fake personalization
- avoid unsupported claims

Never invent agency case studies or results.

==================================================
DIGITAL MARKETING
==================================================

Provide:

- 2 social media ideas
- 1 lead magnet
- 1 landing page offer

==================================================
RESULTS / KPIs
==================================================

Provide:

- relevant KPIs
- realistic targets

Do not guarantee results.

==================================================
SOURCES
==================================================

Use real publicly available sources.

Every important research claim should have a source.

Every source:

{
  "title": "",
  "url": ""
}

Do not invent sources.
Do not invent URLs.

==================================================
FINAL JSON
==================================================

Return ONLY valid JSON.

{
  "recommendedCompany": {
    "rank": 1,
    "name": "",
    "website": "",
    "industry": "",
    "location": "",
    "businessModel": "",
    "companySize": "",
    "agencyFit": 0,
    "serviceFit": 0,
    "marketingOpportunity": "",
    "businessPotential": "",
    "identifiedNeed": "",
    "buyingSignals": [],
    "mainOpportunity": "",
    "score": 0,
    "priority": "",
    "reason": "",
    "competitorRelation": "Primary Recommendation",
    "sources": []
  },

  "competitiveCompanies": [],

  "finalCompanies": [],

  "topCompany": {
    "name": "",
    "website": "",
    "industry": "",
    "location": "",
    "score": 0,
    "priority": "",
    "whyBestFit": "",
    "mainOpportunity": "",
    "recommendedService": "",
    "evidence": []
  },

  "outputs": {
    "leadGeneration": {
      "qualificationReason": "",
      "strategy": "",
      "informationToCollect": [],
      "decisionMakerRole": "",
      "tools": []
    },

    "aiAutomation": {
      "workflow": [],
      "tools": []
    },

    "leadScoring": {
      "finalScore": 0,
      "breakdown": [],
      "strengths": [],
      "weaknesses": [],
      "priority": "",
      "reason": ""
    },

    "outreach": {
      "subject": "",
      "email": ""
    },

    "digitalMarketing": {
      "socialMediaIdeas": [],
      "leadMagnet": "",
      "landingPageOffer": ""
    },

    "results": {
      "kpis": [],
      "targets": []
    }
  },

  "sources": []
}

RULES:

- Return ONLY valid JSON.
- No Markdown.
- No explanations.
- Use real companies.
- Use real sources.
- Do not invent facts.
- Do not invent URLs.
- Do not invent statistics.
- Final list maximum 10 companies.
- #1 must be the strongest agency opportunity.
`;

module.exports = {
  candidatePrompt,
  finalResearchPrompt,
};