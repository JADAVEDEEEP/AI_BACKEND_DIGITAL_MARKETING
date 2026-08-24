# Digital Marketing Automation & AI Lead Research System

An AI-powered B2B lead research and recommendation system built for digital marketing agencies. It figures out who an agency should actually be pitching — and why — instead of leaving that to manual research.

## The Problem

Agencies burn a lot of hours doing the same repetitive work before they ever send an email:

- Finding potential companies to target
- Researching each one's business and marketing setup
- Spotting pain points and gaps in their strategy
- Checking their social media and content presence
- Deciding if they're actually a good fit for the agency's services
- Tracking down the right decision-maker
- Writing outreach that doesn't sound like a template
- Putting together marketing recommendations to back it all up

This system automates that entire chain using AI and publicly available data — so the agency starts the conversation already knowing the company, not just its name.

## How It Works

The agency tells the system three things:

- **Agency Type** — e.g. SEO agency, PPC agency, influencer marketing agency
- **Agency Services** — what they actually offer
- **Agency Requirements** — what kind of client they're looking for

From there, the system runs end-to-end and hands back one primary recommendation, fully researched, along with the outputs needed to act on it.

### 1. Agency Information

The user provides their agency type, services, and requirements. For example:

```
Agency Type: Influencer Marketing Agency

Services:
- Influencer Campaigns
- Instagram Marketing
- Creator Partnerships
- Social Media Marketing

Requirements:
Find companies with strong potential for influencer-led growth
and clear marketing opportunities.
```

### 2. Initial Company Discovery

The AI searches for up to 100 real companies that could plausibly become clients. This is just a candidate pool — none of these get deep research yet.

They're first run through a quick evaluation pass, scored against a few basic criteria, and the poor fits get dropped:

- Agency / ICP fit
- Service fit
- Industry relevance
- Marketing opportunity
- Business potential
- Need / pain point
- Buying signals

The point isn't to shortlist companies because they're big or recognizable — it's to find the ones with a real, identifiable opportunity for this specific agency.

### 3. Best Company Selection

From the surviving candidates, the AI picks the single strongest fit — the one with clear agency fit, service fit, business potential, an identifiable pain point, and buying signals worth acting on. This becomes the **Primary Recommendation**.

### 4. Competitor Discovery

Once the Primary Recommendation is locked in, the AI finds its relevant competitors — companies in the same or an adjacent industry, targeting similar customers, offering similar products or services, and commercially relevant enough to compare against.

These competitors are evaluated using the exact same criteria as the primary company, so everything ends up on one consistent scale.

### 5. Scoring & Ranking

Every finalist — the primary company and its competitors — gets scored out of 100:

| Criterion | Weight |
|---|---|
| Agency / ICP Fit | 25 |
| Service Fit | 20 |
| Marketing Opportunity | 20 |
| Business Potential | 15 |
| Need / Pain Point | 10 |
| Buying Signals | 10 |
| **Total** | **100** |

Priority bands:

| Score | Priority |
|---|---|
| 80–100 | HOT |
| 60–79 | WARM |
| 40–59 | LOW PRIORITY |
| 0–39 | POOR FIT |

The companies are then ranked. The top scorer is the **Primary Recommendation**; everyone else is listed as a **Competitive Alternative**.

**Example:**

| Rank | Company | Score | Priority | Relationship |
|---|---|---|---|---|
| 1 | Oura | 95 | HOT | Primary Recommendation |
| 2 | WHOOP | 88 | HOT | Direct Competitor |
| 3 | Other Company | 84 | HOT | Relevant Competitor |

### 6. Final Recommendation

For the selected company, the system puts together a full profile: name, website, industry, location, business model, company size, agency fit, service fit, marketing opportunity, business potential, identified need, buying signals, main opportunity, score, priority, reasoning, and sources.

It also explains, in plain terms, *why* this is the right company, what the opportunity actually is, which service fits it best, and what evidence backs that up.

### 7. Six Business Outputs

These six outputs are generated only for the #1 Primary Recommendation — not for every candidate.

**Lead Generation**
Qualification reasoning, a lead generation strategy, what information to collect, the decision-maker's likely role, and recommended tools (Apollo, LinkedIn Sales Navigator, Clay).

**AI & Automation**
A suggested workflow — find leads → enrich data → AI research → lead scoring → personalized outreach → CRM → follow-up — with relevant tools (Apollo, Clay, ChatGPT, n8n, Make, Zapier, HubSpot). Only tools that actually fit get recommended.

**Lead Scoring**
Final score, score breakdown, strengths, weaknesses, priority, and the reasoning behind it.

**Personalized Outreach**
One cold email built around company-specific context, a real marketing opportunity, the agency's value proposition, and a clear CTA. No generic or made-up personalization.

**Digital Marketing**
Two social media ideas, one lead magnet, and one landing page offer — all specific to this company and this agency's services.

**Results / KPIs**
Realistic targets across leads generated, qualified leads, outreach sent, response rate, meetings booked, conversion rate, customers acquired, and campaign ROI.

## System Architecture

The application follows a straightforward frontend → backend → AI service flow:

```
React Frontend
      │  agency details
      ▼
Express Backend
      │
      ▼
  AI Service ──► Master Prompt ──► Gemini API
      │                                │
      │                    ┌───────────┴───────────┐
      │                    ▼                        ▼
      │              Web Research               AI Analysis
      │                    └───────────┬───────────┘
      │                                ▼
      │                       Structured JSON
      ▼                                │
Express API  ◄──────────────────────────
      │
      ▼
React Frontend
      │
      ├── Recommendation
      ├── Competitors
      └── 6 Outputs
```

The **frontend** collects agency information and renders the research results. The **backend** handles API requests, prompt generation, Gemini communication, JSON parsing, and response handling. The **AI service** holds the core research logic, and the **master prompt** controls how Gemini evaluates companies and shapes the final structured response.

## Technology Stack

**Frontend**
React.js, Vite, JavaScript, Tailwind CSS, Axios, React Router

**Backend**
Node.js, Express.js, JavaScript, REST API

**AI**
Google Gemini API, `@google/genai`, public web research

**Database**
MongoDB, Mongoose, MongoDB Atlas

**Deployment**
Vercel (frontend), Render (backend), MongoDB Atlas (database)

## Backend Structure

```
backend/
├── controller/
│   └── research.controller.js
├── Services/
│   └── ai.service.js
├── prompts/
│   └── masterPrompt.js
├── model/
│   └── SearchHistory.js
├── routes/
│   └── research.routes.js
├── config/
│   └── database.js
├── server.js
├── package.json
└── .env
```

**`research.controller.js`** receives agency information, validates the request, calls the AI service, returns the generated research, handles API errors, and measures response time.

**`ai.service.js`** initializes Gemini, builds the master prompt, sends the request, receives the response, cleans it up, parses the JSON, and returns structured research data.

**`masterPrompt.js`** is the main intelligence layer of the system. It defines the company discovery strategy, candidate filtering, company evaluation, competitor research, scoring, ranking, primary recommendation logic, the six business outputs, source requirements, and the final JSON structure.

## Frontend Structure

```
frontend/
├── src/
│   ├── components/
│   ├── pages/
│   ├── services/
│   ├── hooks/
│   ├── utils/
│   ├── App.jsx
│   └── main.jsx
├── public/
├── package.json
└── .env
```

The frontend lets the user select the agency type, enter services and requirements, and kick off the AI research. It then displays the recommended company, competitor comparisons, lead scoring, AI automation recommendations, personalized outreach, digital marketing ideas, and KPIs/results.

## API

### Generate Research

`POST /api/research`

**Request body**

```json
{
  "agencyType": "Influencer Marketing Agency",
  "agencyServices": [
    "Influencer Campaigns",
    "Instagram Marketing",
    "Creator Partnerships",
    "Social Media Marketing"
  ],
  "agencyRequirements": "Find companies with strong potential for influencer-led growth and clear marketing opportunities."
}
```

**Response**

```json
{
  "success": true,
  "message": "Lead research generated successfully.",
  "data": {
    "agencyAnalysis": {},
    "recommendedCompany": {},
    "competitiveCompanies": [],
    "finalCompanies": [],
    "topCompany": {},
    "outputs": {
      "leadGeneration": {},
      "aiAutomation": {},
      "leadScoring": {},
      "outreach": {},
      "digitalMarketing": {},
      "results": {}
    },
    "sources": []
  },
  "responseTime": 6496
}
```

## AI Research Pipeline

The research process is deliberately broken into stages rather than run as one giant AI call:

```
Agency Information
       ↓
Candidate Discovery
       ↓
Quick Candidate Evaluation
       ↓
Poor-Fit Removal
       ↓
Best Potential Company
       ↓
Competitor Discovery
       ↓
Competitor Evaluation
       ↓
Scoring
       ↓
Ranking
       ↓
Primary Recommendation
       ↓
6 Business Outputs
```

The initial candidate pool exists for discovery and filtering only — not for generating a detailed report on every company. That keeps the final response focused on the companies that actually matter.

### Master Prompt Strategy

The master prompt takes three dynamic inputs:

```js
{
  agencyType,
  agencyServices,
  agencyRequirements
}
```

From there it drives the entire research workflow. The core objective given to the model is simple: find the strongest potential client for the agency and turn that research into actionable business outputs. The prompt also requires structured JSON output, so the frontend can consume the response directly without extra transformation.

### Structured AI Output

The AI response follows a fixed shape:

```
agencyAnalysis
  ├── agencyType
  ├── services
  ├── requirements
  ├── idealCustomerProfile
  └── evaluationCriteria

recommendedCompany
  ├── company information
  ├── scoring
  ├── opportunity
  ├── buying signals
  └── sources

competitiveCompanies   → competitor evaluations
finalCompanies         → ranked companies
topCompany             → primary recommendation

outputs
  ├── leadGeneration
  ├── aiAutomation
  ├── leadScoring
  ├── outreach
  ├── digitalMarketing
  └── results

sources
```

Keeping the response this structured lets the frontend render each section independently.

### JSON Reliability

Inconsistent AI output was one of the bigger challenges during development. Gemini is instructed to return JSON, and the backend still does a cleanup pass before parsing, since models sometimes wrap output in Markdown fences:

```js
let text = response.text?.trim();

if (text.startsWith("```json")) {
  text = text.replace(/```json|```/g, "").trim();
}

const report = JSON.parse(text);
```

## Environment Variables

Create a local `.env` file:

```
GEMINI_API_KEY=your_gemini_api_key
MONGODB_URI=your_mongodb_connection_string
PORT=5000
```

The API key and database credentials are never exposed to the frontend. Add these to `.gitignore`:

```
.env
.env.local
.env.*.local
node_modules
```

In production, environment variables are set directly on the deployment platform instead of shipping a `.env` file.

## Local Development

**Backend**

```bash
cd backend
npm install
npm run dev
```

or

```bash
node server.js
```

Runs at `http://localhost:5000`.

**Frontend**

```bash
cd frontend
npm install
npm run dev
```

Runs at `http://localhost:5173`.

## Production Deployment

**Frontend** — deployed on Vercel, pointed at the production API:

```
VITE_API_URL=https://your-backend.onrender.com
```

**Backend** — deployed on Render.

- Build command: `npm install`
- Start command: `node server.js`

The server reads its port from the environment so Render can assign it:

```js
const PORT = process.env.PORT || 5000;
```

**Database** — MongoDB Atlas is used for production hosting.

## Security

Sensitive credentials stay on the backend only. These values must never be exposed in frontend code:

- `GEMINI_API_KEY`
- `MONGODB_URI`

The `.env` file must never be committed to GitHub. The frontend only ever talks to the backend API; the backend is the only thing that talks to Gemini.

## AI Performance Strategy

A key design decision was to avoid running deep research on every company in the candidate pool. The naive approach doesn't scale:

```
100 Companies → 100 Deep Research Reports → Huge AI Response
```

Instead, the system narrows the field before going deep:

```
100 Candidates → Quick Evaluation → Filter → Best Company
    → Competitor Research → Focused Detailed Analysis
```

This cuts down token consumption, response size, processing time, unnecessary research, and the overall surface area for hallucination.

## Hallucination Reduction

Early on, large unrestricted prompts caused real problems: oversized responses, slow generation, inconsistent company selection, unsupported claims, invalid JSON, and generic or incorrect sources.

The prompt was tightened to explicitly constrain the model. It's told to:

- Not invent companies, facts, statistics, sources, or URLs
- Use only publicly available information
- Return valid JSON
- Follow the defined scoring system
- Generate detailed outputs only for the primary recommendation

That makes the output far more predictable, and much easier for the frontend to consume reliably.

## Error Handling

The backend handles the common failure modes when talking to Gemini:

- **429 — Quota / Rate Limit**: the API rejects requests once quota is exceeded.
- **503 — Temporary Unavailability**: the selected model is under high demand.
- **404 — Model Availability**: a model becomes unavailable or its availability changes.
- **Invalid JSON**: the backend strips Markdown code fences before attempting to parse.

Whenever AI generation fails, the controller returns an appropriate error response instead of crashing the request.

## Example Scenario

An agency provides:

```
Agency Type: Influencer Marketing Agency

Services:
- Influencer Campaigns
- Instagram Marketing
- Creator Partnerships
- Social Media Marketing

Requirements:
Find companies with strong potential for influencer-led growth
and clear marketing opportunities.
```

The system might return:

- **Primary Recommendation:** Oura
- **Score:** 95 / 100
- **Priority:** HOT
- **Recommended Service:** Creator Partnerships & Instagram Marketing

It then finds relevant competitors and evaluates them against the same requirements — giving the agency one clear company to approach, instead of an unqualified list to sort through themselves.

## Why This Approach?

The project is built around one idea: **don't just find companies — find the company the agency has the strongest reason to approach.**

Traditional lead research produces a list. This system produces a recommendation.

```
Company Discovery
       ↓
Company Qualification
       ↓
Opportunity Identification
       ↓
Competitive Intelligence
       ↓
Lead Scoring
       ↓
Primary Recommendation
       ↓
Actionable Sales Strategy
```

That turns AI research into an actual business-development workflow, not just another report generator.

## Future Improvements

- SEO agency workflows
- PPC agency workflows
- Influencer marketing workflows
- Automated decision-maker discovery
- LinkedIn enrichment
- Email verification
- CRM integration
- n8n automation
- Automated outreach and follow-ups
- Lead history and saved reports
- CSV / PDF export
- Advanced competitor analysis
- Lead monitoring
- Campaign performance tracking

## Project Status

- [x] Agency information input
- [x] AI-powered company discovery
- [x] Candidate filtering
- [x] Best company selection
- [x] Competitor discovery
- [x] Company scoring
- [x] Company ranking
- [x] Primary recommendation
- [x] Lead generation output
- [x] AI automation output
- [x] Lead scoring output
- [x] Personalized outreach
- [x] Digital marketing recommendations
- [x] Results / KPI generation
- [x] Structured JSON response
- [x] Frontend and backend integration
- [x] Gemini API integration
- [x] Environment-based configuration
- [x] Production deployment setup

## Final Architecture

```
                         USER
                          │
                          ▼
                  AGENCY INFORMATION
                          │
                          ▼
                    REACT FRONTEND
                          │
                          ▼
                    EXPRESS API
                          │
                          ▼
                     AI SERVICE
                          │
                          ▼
                    MASTER PROMPT
                          │
                          ▼
                     GEMINI AI
                          │
                          ▼
                COMPANY RESEARCH
                          │
                          ▼
                CANDIDATE FILTERING
                          │
                          ▼
                 BEST-FIT COMPANY
                          │
                          ▼
                COMPETITOR RESEARCH
                          │
                          ▼
                  SCORE & RANKING
                          │
                          ▼
                PRIMARY RECOMMENDATION
                          │
                          ▼
                   6 AI OUTPUTS
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
    Lead Generation   AI Automation   Lead Scoring
          │               │               │
          └───────────────┼───────────────┘
                          ▼
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
       Outreach    Digital Marketing    Results
                          │
                          ▼
                    REACT FRONTEND
```

## Core Principle

This system doesn't just generate AI reports. It takes an agency's services and requirements, discovers potential companies, filters and evaluates them, identifies the strongest client opportunity, compares relevant competitors, scores everything on a consistent scale, and turns the final recommendation into actionable lead generation, automation, outreach, digital marketing, and KPI strategy.