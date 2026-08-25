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

Each candidate MUST have:

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

RULES:

- Real companies only.
- Do not invent companies.
- Do not duplicate companies.
- Do not use fake URLs.
- Prefer companies with genuine potential to purchase the agency services.
- Do not prefer companies merely because they are famous or large.
- Try to return exactly 100 candidates.
- If fewer than 100 genuinely relevant companies can be identified, return as many real companies as possible.
- Never fabricate companies to reach 100.
- Every candidate must be unique.
- Rank must be sequential from 1.
- Website should be the company's actual public website whenever available.
- Keep candidate information concise.

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

==================================================
INITIAL CANDIDATE POOL
==================================================

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

The #1 company must genuinely be the strongest opportunity for the agency.

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

If fewer than 9 genuine competitors are available, return fewer.

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

Do not create a score that does not match the breakdown.

==================================================
FINAL COMPANY INFORMATION
==================================================

For EVERY final company provide:

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

IMPORTANT:

The following fields MUST be populated whenever publicly available:

- website
- industry
- location
- businessModel
- companySize
- mainOpportunity
- competitorRelation

Do not unnecessarily return "-" or empty values when reliable public information is available.

competitorRelation MUST be exactly one of:

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

Do not force tools into the workflow.

Possible tools include:

ChatGPT
Apollo
Clay
n8n
Make
Zapier
HubSpot

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

IMPORTANT:

finalScore MUST equal the actual company score.

The breakdown MUST mathematically equal finalScore.

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

Never invent agency case studies.

Never invent campaign results.

Never claim that the agency achieved a result unless that result was provided in the agency information.

==================================================
DIGITAL MARKETING
==================================================

Provide:

- 2 social media ideas
- 1 lead magnet
- 1 landing page offer

All recommendations must be relevant to:

1. The selected company
2. The agency type
3. The agency services
4. The identified opportunity

==================================================
RESULTS / KPIs
==================================================

Provide:

- relevant KPIs
- realistic targets

Do not guarantee results.

Do not invent historical performance statistics.

Targets must be framed as goals or benchmarks, not guaranteed outcomes.

==================================================
SOURCES
==================================================

Use real publicly available sources.

Every important research claim should have a source.

Every source MUST contain:

{
  "title": "",
  "url": ""
}

Do not invent sources.

Do not invent URLs.

Prefer official company websites, official newsroom pages, official product pages, and other reliable public sources.

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
    "sources": [
      {
        "title": "",
        "url": ""
      }
    ]
  },

  "competitiveCompanies": [
    {
      "rank": 2,
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
      "competitorRelation": "Direct Competitor",
      "sources": [
        {
          "title": "",
          "url": ""
        }
      ]
    }
  ],

  "finalCompanies": [
    {
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
      "competitorRelation": "",
      "sources": [
        {
          "title": "",
          "url": ""
        }
      ]
    }
  ],

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

  "sources": [
    {
      "title": "",
      "url": ""
    }
  ]
}

==================================================
FINAL RULES
==================================================

- Return ONLY valid JSON.
- No Markdown.
- No explanations.
- Use real companies.
- Use real sources.
- Do not invent facts.
- Do not invent URLs.
- Do not invent statistics.
- Do not invent competitors.
- Final list maximum 10 companies.
- #1 must be the strongest agency opportunity.
- Rank must be sequential.
- Scores must follow the exact scoring system.
- Score breakdown must mathematically equal the final score.
- Generate detailed business outputs ONLY for #1.
- Do not generate detailed outputs for competitors.
- Do not replace the provided candidate pool.
- Do not perform unnecessary deep research on all 100 initial candidates.
- Use the initial candidate pool as the discovery source.
- If a fact cannot be reliably established, omit it or clearly state that it could not be verified.
`;

module.exports = {
  candidatePrompt,
  finalResearchPrompt,
};