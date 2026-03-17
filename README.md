# LangGraph Stage0 Gate

A minimal example demonstrating how to integrate [SignalPulse Stage0](https://signalpulse.org/docs) runtime guard with LangGraph agents.

**Links**: [Documentation](https://signalpulse.org/docs) | [Dashboard](https://signalpulse.org/dashboard) | [API Keys](https://signalpulse.org/dashboard/settings/api-keys) | [Policy Templates](https://signalpulse.org/policy-templates)

## Problem Scenario

AI agents are great at executing tasks, but they can silently escalate from safe operations to risky actions:

- **Research → Deployment**: An agent researching an incident might decide to deploy a hotfix
- **Drafting → Publishing**: An agent drafting content might publish it without approval
- **Analysis → Execution**: An agent analyzing data might execute shell commands autonomously

Without a runtime guard, agents can cross the boundary from "helpful assistant" to "autonomous actor" without any external validation.

## What is Stage0?

Stage0 is a **runtime policy authority** that validates every execution intent before the action happens. It returns one of three verdicts:

| Verdict | Meaning |
|---------|---------|
| `ALLOW` | Safe to proceed |
| `DENY` | Blocked - action not authorized |
| `DEFER` | Requires human review before proceeding |

## Where Stage0 Fits

```
┌─────────────────────────────────────────────────────────────┐
│                    Your LangGraph Agent                      │
│                                                              │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────────┐   │
│  │  Plan    │───▶│  Stage0      │───▶│  Execute if      │   │
│  │  Step    │    │  Validation  │    │  ALLOW           │   │
│  └──────────┘    └──────────────┘    └──────────────────┘   │
│                        │                                    │
│                        ▼                                    │
│                  ┌──────────┐                              │
│                  │  DENY/   │                              │
│                  │  DEFER   │                              │
│                  └──────────┘                              │
└─────────────────────────────────────────────────────────────┘
```

Stage0 sits **between planning and execution**. Every tool call is validated before the agent can proceed.

## Quick Start

### Prerequisites

- Node.js 18 or newer
- npm or pnpm
- A Stage0 API key from [SignalPulse](https://signalpulse.org) (optional - demo works with simulated responses)

### Installation

```bash
# Clone or copy this example
cd langgraph-stage0-gate

# Install dependencies
npm install

# Copy environment file
cp .env.example .env
```

### Configure API Key (Optional)

Edit `.env` and add your Stage0 API key:

```env
STAGE0_API_KEY=your_api_key_here
STAGE0_BASE_URL=https://api.signalpulse.org
```

Without an API key, the demo uses simulated Stage0 responses.

## Run the Demo

### Run ALLOW example (safe operations)

```bash
npm run demo:allow
```

This demonstrates a research workflow where all operations are informational and should be ALLOWED.

### Run DENY example (blocked risky operations)

```bash
npm run demo:deny
```

This demonstrates a deployment workflow where high-risk operations are blocked by Stage0.

### Run all scenarios

```bash
npm run demo:all
```

## Expected Output

> **Note**: The examples below show output with a configured API key (LIVE DEMO). Without an API key, you'll see SIMULATED DEMO with similar behavior but simulated responses.

### ALLOW Example

```
======================================================================
                LIVE DEMO: Research Assistant - ALLOW Example
======================================================================

Goal: Research Python web frameworks for building APIs
Context: {
  "actor_role": "developer",
  "environment": "development",
  "request_channel": "cli"
}

Using real Stage0 API for validation.

======================================================================
AGENT RUN: Research Python web frameworks for building APIs
======================================================================

STEPS:
----------------------------------------------------------------------
  Step 1: web_search
    Goal: Search for Python web framework comparison
    Status: [ALLOWED] (ALLOW)

  Step 2: read_file
    Goal: Read existing project requirements
    Status: [ALLOWED] (ALLOW)

======================================================================
SUMMARY
======================================================================
  Total steps: 2
  Allowed: 2
  Blocked: 0
```

### DENY Example

```
======================================================================
                LIVE DEMO: Production Deployment - DENY Example
======================================================================

Goal: Deploy hotfix to production without approval
Context: {
  "actor_role": "developer",
  "approval_status": "pending",
  "environment": "production",
  "request_channel": "cli"
}

Using real Stage0 API for validation.

======================================================================
AGENT RUN: Deploy hotfix to production without approval
======================================================================

STEPS:
----------------------------------------------------------------------
  Step 1: web_search
    Goal: Research best practices for hotfix deployment
    Status: [ALLOWED] (ALLOW)

  Step 2: read_file
    Goal: Read incident report
    Status: [ALLOWED] (ALLOW)

  Step 3: deploy_code
    Goal: Deploy hotfix to production servers
    Status: [BLOCKED] (DENY)
    Reason: SIDE_EFFECTS_NEED_GUARDRAILS: External/irreversible side effects declared without machine-readable guardrails in constraints.
    Request ID: 3247271c-2c6d-4c72-a6ba-df8a4053ec75
    Policy Version: stage0-policy-pack@0.1.0

  Step 4: execute_shell
    Goal: Run database migration in production
    Status: [ALLOWED] (ALLOW)

======================================================================
SUMMARY
======================================================================
  Total steps: 4
  Allowed: 3
  Blocked: 1

BLOCKED STEPS:
  - Step 3: deploy_code (DENY)
```

## Where request_id and policy_version Appear

Every Stage0 `/check` response includes:

```typescript
{
  verdict: "ALLOW" | "DENY" | "DEFER",
  reason: "Human-readable explanation",
  request_id: "req_abc123...",      // Unique per request
  policy_version: "v1.2.3",         // Policy pack version used
  // ... other fields
}
```

### request_id

- **Generated by**: Stage0 API (or simulated in demo)
- **Purpose**: Unique identifier for debugging and audit trails
- **Location**: `response.request_id` in every PolicyResponse
- **Use case**: Correlate decisions in logs, dashboard, and support tickets

### policy_version

- **Generated by**: Stage0 policy engine
- **Purpose**: Track which policy pack was used for evaluation
- **Location**: `response.policy_version` or `response.policy_pack_version`
- **Use case**: Audit compliance, debug policy changes, ensure consistency

## Integration Guide

### Basic Integration

```typescript
// Import from local module
import { Stage0Client, Verdict } from "./stage0/index.js";

const client = new Stage0Client();

async function executeWithGuard(toolName: string, goal: string) {
  const response = await client.checkGoal({
    goal,
    success_criteria: ["Task completes successfully"],  // What success looks like
    constraints: ["read-only", "approval_required"],     // Guardrails
    tools: [toolName],
    side_effects: ["deploy"],  // Declare side effects
    context: {
      environment: "production",
      approval_status: "approved",
    },
  });

  if (response.verdict !== Verdict.ALLOW) {
    console.log(`Blocked: ${response.reason}`);
    console.log(`Request ID: ${response.request_id}`);
    return;
  }

  // Safe to execute
  await executeTool(toolName);
}
```

### With LangGraph

```typescript
// Import from local module
import { Stage0ToolGate } from "./agent/tool-gate.js";
import { Stage0Client } from "./stage0/index.js";

const client = new Stage0Client();
const gate = new Stage0ToolGate({
  stage0Client: client,
  defaultContext: { environment: "production" },
});

// In your LangGraph node
const result = await gate.executeWithGate({
  toolName: "deploy_code",
  goal: "Deploy to production",
  success_criteria: ["Deployment completes without errors"],
  constraints: ["dry-run first", "rollback plan required"],
  executor: async () => {
    // Only runs if ALLOWED
    return await deployToProduction();
  },
});

if (result.blocked) {
  console.log(`Blocked: ${result.block_reason}`);
}
```

## Project Structure

```
langgraph-stage0-gate/
├── src/
│   ├── index.ts           # Entry point and demo runner
│   ├── stage0/
│   │   ├── client.ts      # Stage0 API client
│   │   └── index.ts       # Module exports
│   ├── agent/
│   │   ├── agent.ts       # LangGraph agent with gate
│   │   └── tool-gate.ts   # Tool execution gate
│   └── demo/
│       ├── scenarios.ts   # Demo scenarios
│       └── simulated.ts   # Simulated API responses
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## Available Tools

The demo includes these tool definitions with their side effects:

| Tool | Side Effects | Risk Level |
|------|--------------|------------|
| `web_search` | None | Low |
| `read_file` | None | Low |
| `write_file` | `write` | Medium |
| `send_email` | `send`, `external_api` | Medium |
| `publish_content` | `publish`, `external_api` | High |
| `deploy_code` | `deploy`, `production` | High |
| `execute_shell` | `execute`, `shell` | High |
| `delete_data` | `delete`, `data_modification` | High |

## Success Criteria

You should be able to:

1. ✅ Install dependencies in under 2 minutes
2. ✅ Run the demo without an API key (simulated mode)
3. ✅ See a tool call get BLOCKED within 10-15 minutes
4. ✅ Understand where `request_id` and `policy_version` appear
5. ✅ Know how to integrate Stage0 into your own LangGraph agent

## Get Started with Real Stage0

1. Visit [signalpulse.org](https://signalpulse.org/)
2. Create an account
3. Generate an API key
4. Add it to your `.env` file
5. Run the demo again for live policy decisions

## License

MIT