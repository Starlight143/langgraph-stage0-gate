import { config } from "dotenv";
config();

import { Stage0Client, Verdict } from "./stage0/index.js";
import { LangGraphAgent, formatResult } from "./agent/agent.js";
import { TOOL_DEFINITIONS } from "./agent/tool-gate.js";
import { getScenario, listScenarios } from "./demo/scenarios.js";
import { simulateStage0Response } from "./demo/simulated.js";

function printHeader(title: string): void {
  console.log();
  console.log("=".repeat(70));
  console.log(title.padStart((70 + title.length) / 2));
  console.log("=".repeat(70));
  console.log();
}

function printSection(title: string): void {
  console.log();
  console.log("-".repeat(70));
  console.log(`  ${title}`);
  console.log("-".repeat(70));
  console.log();
}

function hasApiKey(): boolean {
  const key = process.env.STAGE0_API_KEY;
  return Boolean(key && key !== "your_api_key_here");
}

async function runSimulatedDemo(scenarioKey: string): Promise<void> {
  const scenario = getScenario(scenarioKey);

  printSection(`SIMULATED DEMO: ${scenario.title}`);
  console.log(`Goal: ${scenario.goal}`);
  console.log(`Context: ${JSON.stringify(scenario.context, null, 2)}`);
  console.log();

  console.log("Since no API key is configured, using simulated Stage0 responses.");
  console.log();

  console.log("PLAN:");
  console.log("-".repeat(70));

  for (const step of scenario.plan) {
    const simulated = simulateStage0Response({
      side_effects: getSideEffectsForTool(step.toolName),
      context: scenario.context,
    });

    const status = simulated.verdict === Verdict.ALLOW ? "[ALLOWED]" : "[BLOCKED]";

    console.log(`  Tool: ${step.toolName}`);
    console.log(`    Goal: ${step.goal}`);
    console.log(`    Expected: ${step.expectedVerdict}`);
    console.log(`    Simulated: ${simulated.verdict}`);
    console.log(`    Status: ${status}`);
    console.log(`    Reason: ${simulated.reason}`);
    console.log(`    Request ID: ${simulated.request_id}`);
    console.log(`    Policy Version: ${simulated.policy_version}`);
    console.log();
  }

  printSection("RESULT");
  console.log(`Why this matters: ${scenario.whyItMatters}`);
  console.log();
  console.log(`Without Stage0: ${scenario.unguardedRisk}`);
  console.log();
  console.log(`With Stage0: ${scenario.guardedOutcome}`);
  console.log();

  const blockedCount = scenario.plan.filter((s) => s.expectedVerdict !== "ALLOW").length;
  const allowedCount = scenario.plan.filter((s) => s.expectedVerdict === "ALLOW").length;

  console.log("Summary:");
  console.log(`  - Steps allowed: ${allowedCount}`);
  console.log(`  - Steps blocked: ${blockedCount}`);
  console.log();

  console.log("To run with real Stage0 validation:");
  console.log("  1. Get an API key from https://signalpulse.org");
  console.log("  2. Set STAGE0_API_KEY in your .env file");
  console.log("  3. Run this demo again");
}

function getSideEffectsForTool(toolName: string): string[] {
  return TOOL_DEFINITIONS[toolName]?.side_effects ?? [];
}

async function runRealDemo(client: Stage0Client, scenarioKey: string): Promise<void> {
  const scenario = getScenario(scenarioKey);

  printSection(`LIVE DEMO: ${scenario.title}`);
  console.log(`Goal: ${scenario.goal}`);
  console.log(`Context: ${JSON.stringify(scenario.context, null, 2)}`);
  console.log();
  console.log("Using real Stage0 API for validation.");
  console.log();

  const agent = new LangGraphAgent(client, scenario.context);

  const result = await agent.runPlan(
    scenario.goal,
    scenario.plan.map((s) => ({
      toolName: s.toolName,
      goal: s.goal,
      success_criteria: s.success_criteria,
      constraints: s.constraints,
    }))
  );

  console.log(formatResult(result));

  printSection("ANALYSIS");
  console.log(`Why this matters: ${scenario.whyItMatters}`);
  console.log();
  console.log(`Without Stage0: ${scenario.unguardedRisk}`);
  console.log();
  console.log(`With Stage0: ${scenario.guardedOutcome}`);

  printSection("METADATA");
  console.log("The following metadata is returned by Stage0 for each request:");
  console.log();
  console.log("  request_id:");
  console.log("    - Unique identifier for this policy check");
  console.log("    - Used for debugging and audit trails");
  console.log("    - Appears in Stage0 logs and dashboard");
  console.log();
  console.log("  policy_version:");
  console.log("    - Version of the policy pack used for evaluation");
  console.log("    - Allows tracking policy changes over time");
  console.log("    - Useful for compliance and debugging");
  console.log();

  if (result.blockedSteps.length > 0) {
    const firstBlocked = result.blockedSteps[0];
    if (firstBlocked?.stage0Response) {
      console.log("Example from blocked step:");
      console.log(`  Request ID: ${firstBlocked.stage0Response.request_id}`);
      console.log(`  Policy Version: ${firstBlocked.stage0Response.policy_version}`);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  // Support both --scenario=value and --scenario value formats
  let scenarioArg = "all";
  const scenarioIndex = args.indexOf("--scenario");
  if (scenarioIndex !== -1 && args[scenarioIndex + 1]) {
    scenarioArg = args[scenarioIndex + 1] ?? "all";
  } else {
    const eqArg = args.find((a) => a.startsWith("--scenario="));
    if (eqArg) {
      scenarioArg = eqArg.split("=")[1] ?? "all";
    }
  }

  printHeader("LangGraph Stage0 Gate Demo");

  console.log("This demo shows how Stage0 protects LangGraph agents from");
  console.log("unauthorized tool execution by validating each step before it runs.");
  console.log();

  console.log("Available scenarios:");
  for (const scenario of listScenarios()) {
    console.log(`  - ${scenario.key}: ${scenario.title}`);
  }
  console.log();

  if (!hasApiKey()) {
    console.log("NOTE: STAGE0_API_KEY not configured.");
    console.log("The demo will use simulated Stage0 responses.");
    console.log();
  }

  const scenariosToRun = scenarioArg === "all" 
    ? listScenarios().map((s) => s.key)
    : [scenarioArg];

  for (const key of scenariosToRun) {
    try {
      if (hasApiKey()) {
        const client = new Stage0Client();
        await runRealDemo(client, key);
      } else {
        await runSimulatedDemo(key);
      }
    } catch (error) {
      console.error(`Error running scenario '${key}':`, error);
    }

    if (scenariosToRun.indexOf(key) < scenariosToRun.length - 1) {
      console.log();
      console.log("--- Press Enter to continue to the next scenario ---");
    }
  }

  printHeader("Demo Complete");
  console.log("Key takeaways:");
  console.log();
  console.log("1. Stage0 acts as an external authority for tool execution");
  console.log("2. Each tool call is validated BEFORE execution");
  console.log("3. High-risk actions are blocked without proper approval");
  console.log("4. Safe research and read operations proceed normally");
  console.log("5. request_id and policy_version enable audit trails");
  console.log();
  console.log("Next steps:");
  console.log("  - Get an API key at https://signalpulse.org");
  console.log("  - Integrate Stage0 into your LangGraph agents");
  console.log("  - Configure policies for your specific use case");
  console.log();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});