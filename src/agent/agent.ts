import { Stage0Client, Verdict, type PolicyResponse, type RuntimeContext } from "../stage0/index.js";
import { Stage0ToolGate, type ToolCallResult } from "./tool-gate.js";

export interface AgentRunResult {
  goal: string;
  steps: AgentStep[];
  finalOutput: string;
  blockedSteps: AgentStep[];
  allowedSteps: AgentStep[];
}

export interface AgentStep {
  stepId: number;
  toolName: string;
  goal: string;
  result?: ToolCallResult;
  stage0Response?: PolicyResponse;
  executed: boolean;
  blocked: boolean;
}

export class LangGraphAgent {
  private gate: Stage0ToolGate;

  constructor(client: Stage0Client, context?: RuntimeContext) {
    this.gate = new Stage0ToolGate({
      stage0Client: client,
      defaultContext: context,
    });
  }

  async runPlan(goal: string, plan: Array<{
    toolName: string;
    goal: string;
    success_criteria?: string[];
    constraints?: string[];
    arguments?: Record<string, unknown>;
  }>): Promise<AgentRunResult> {
    const steps: AgentStep[] = [];
    const outputs: string[] = [];
    let stepCounter = 0;

    for (const step of plan) {
      const stepId = ++stepCounter;
      const agentStep: AgentStep = {
        stepId,
        toolName: step.toolName,
        goal: step.goal,
        executed: false,
        blocked: false,
      };

      const response = await this.gate.checkToolExecution({
        toolName: step.toolName,
        goal: step.goal,
        success_criteria: step.success_criteria,
        constraints: step.constraints,
        arguments: step.arguments,
      });

      agentStep.stage0Response = response;
      agentStep.result = {
        success: response.verdict === Verdict.ALLOW,
        output: "",
        stage0_response: response,
        skipped: response.verdict !== Verdict.ALLOW,
        blocked: response.verdict !== Verdict.ALLOW,
        block_reason: response.verdict !== Verdict.ALLOW ? response.reason : undefined,
      };

      if (response.verdict === Verdict.ALLOW) {
        agentStep.executed = true;
        const mockOutput = this.simulateToolExecution(step.toolName, step.goal);
        agentStep.result.output = mockOutput;
        outputs.push(`[Step ${stepId}] ${step.goal}: ${mockOutput}`);
      } else {
        agentStep.blocked = true;
        outputs.push(`[Step ${stepId}] BLOCKED: ${step.goal} - ${response.reason}`);
      }

      steps.push(agentStep);
    }

    const blockedSteps = steps.filter((s) => s.blocked);
    const allowedSteps = steps.filter((s) => s.executed);

    return {
      goal,
      steps,
      finalOutput: outputs.join("\n"),
      blockedSteps,
      allowedSteps,
    };
  }

  private simulateToolExecution(toolName: string, goal: string): string {
    const outputs: Record<string, string> = {
      web_search: `Search results for: ${goal}`,
      read_file: `File content read successfully`,
      write_file: `File written successfully`,
      send_email: `Email sent successfully`,
      publish_content: `Content published to public channel`,
      deploy_code: `Code deployed to production`,
      execute_shell: `Shell command executed`,
      delete_data: `Data deleted successfully`,
    };
    return outputs[toolName] ?? `Tool ${toolName} executed`;
  }
}

export function formatResult(result: AgentRunResult): string {
  const lines: string[] = [];

  lines.push("=".repeat(70));
  lines.push(`AGENT RUN: ${result.goal}`);
  lines.push("=".repeat(70));
  lines.push("");

  lines.push("STEPS:");
  lines.push("-".repeat(70));

  for (const step of result.steps) {
    const status = step.executed ? "[ALLOWED]" : "[BLOCKED]";
    const verdict = step.stage0Response?.verdict ?? "UNKNOWN";
    lines.push(`  Step ${step.stepId}: ${step.toolName}`);
    lines.push(`    Goal: ${step.goal}`);
    lines.push(`    Status: ${status} (${verdict})`);
    if (step.blocked && step.stage0Response) {
      lines.push(`    Reason: ${step.stage0Response.reason}`);
      lines.push(`    Request ID: ${step.stage0Response.request_id}`);
      lines.push(`    Policy Version: ${step.stage0Response.policy_version}`);
    }
    lines.push("");
  }

  lines.push("=".repeat(70));
  lines.push("SUMMARY");
  lines.push("=".repeat(70));
  lines.push(`  Total steps: ${result.steps.length}`);
  lines.push(`  Allowed: ${result.allowedSteps.length}`);
  lines.push(`  Blocked: ${result.blockedSteps.length}`);
  lines.push("");

  if (result.blockedSteps.length > 0) {
    lines.push("BLOCKED STEPS:");
    for (const step of result.blockedSteps) {
      lines.push(`  - Step ${step.stepId}: ${step.toolName} (${step.stage0Response?.verdict})`);
    }
    lines.push("");
  }

  return lines.join("\n");
}