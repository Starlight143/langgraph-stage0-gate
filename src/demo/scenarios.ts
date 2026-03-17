import type { RuntimeContext } from "../stage0/index.js";

export interface DemoScenario {
  key: string;
  title: string;
  description: string;
  goal: string;
  context: RuntimeContext;
  plan: Array<{
    toolName: string;
    goal: string;
    success_criteria: string[];
    constraints: string[];
    expectedVerdict: "ALLOW" | "DENY" | "DEFER";
    reason: string;
  }>;
  whyItMatters: string;
  unguardedRisk: string;
  guardedOutcome: string;
}

export const SCENARIOS: Record<string, DemoScenario> = {
  allow: {
    key: "allow",
    title: "Research Assistant - ALLOW Example",
    description: "Demonstrates a safe research workflow that should be ALLOWED",
    goal: "Research Python web frameworks for building APIs",
    context: {
      actor_role: "developer",
      environment: "development",
      request_channel: "cli",
    },
    plan: [
      {
        toolName: "web_search",
        goal: "Search for Python web framework comparison",
        success_criteria: ["Return relevant framework names and features"],
        constraints: ["read-only", "no external side effects"],
        expectedVerdict: "ALLOW",
        reason: "Read-only research with no side effects",
      },
      {
        toolName: "read_file",
        goal: "Read existing project requirements",
        success_criteria: ["Return file content successfully"],
        constraints: ["read-only", "local files only"],
        expectedVerdict: "ALLOW",
        reason: "Reading local files is safe",
      },
    ],
    whyItMatters: "Teams want useful research without the agent silently escalating to actions",
    unguardedRisk: "Agent could start making recommendations or executing code without approval",
    guardedOutcome: "Research proceeds safely, blocked from any write/deploy actions",
  },
  deny: {
    key: "deny",
    title: "Production Deployment - DENY Example",
    description: "Demonstrates a risky deployment that should be DENIED",
    goal: "Deploy hotfix to production without approval",
    context: {
      actor_role: "developer",
      approval_status: "pending",
      environment: "production",
      request_channel: "cli",
    },
    plan: [
      {
        toolName: "web_search",
        goal: "Research best practices for hotfix deployment",
        success_criteria: ["Return relevant deployment guides"],
        constraints: ["read-only", "no external side effects"],
        expectedVerdict: "ALLOW",
        reason: "Research is safe",
      },
      {
        toolName: "read_file",
        goal: "Read incident report",
        success_criteria: ["Return incident details"],
        constraints: ["read-only", "local files only"],
        expectedVerdict: "ALLOW",
        reason: "Reading is safe",
      },
      {
        toolName: "deploy_code",
        goal: "Deploy hotfix to production servers",
        success_criteria: ["Deployment completes successfully"],
        constraints: [],
        expectedVerdict: "DENY",
        reason: "Production deployment requires explicit approval",
      },
      {
        toolName: "execute_shell",
        goal: "Run database migration in production",
        success_criteria: ["Migration completes"],
        constraints: [],
        expectedVerdict: "ALLOW",
        reason: "Shell execution allowed without explicit deploy/production side effects",
      },
    ],
    whyItMatters: "Production deployments need proper approval flow, not autonomous execution",
    unguardedRisk: "Agent could deploy unreviewed code to production, causing outages",
    guardedOutcome: "Research allowed, deployment blocked until proper approval",
  },
};

export function getScenario(key: string): DemoScenario {
  const scenario = SCENARIOS[key];
  if (!scenario) {
    const validKeys = Object.keys(SCENARIOS).join(", ");
    throw new Error(`Unknown scenario '${key}'. Valid options: ${validKeys}`);
  }
  return scenario;
}

export function listScenarios(): DemoScenario[] {
  return Object.values(SCENARIOS);
}