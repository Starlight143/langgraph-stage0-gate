import { Stage0Client, Verdict, Decision, type PolicyResponse, type RuntimeContext } from "../stage0/index.js";

export interface ToolDefinition {
  name: string;
  description: string;
  side_effects: string[];
  risk_level: "low" | "medium" | "high";
}

export interface ToolCallResult {
  success: boolean;
  output: string;
  stage0_response?: PolicyResponse;
  skipped?: boolean;
  blocked?: boolean;
  block_reason?: string;
}

export interface AgentConfig {
  stage0Client: Stage0Client;
  defaultContext?: RuntimeContext;
  onDecision?: (tool: string, response: PolicyResponse) => void;
}

export const TOOL_DEFINITIONS: Record<string, ToolDefinition> = {
  web_search: {
    name: "web_search",
    description: "Search the web for information",
    side_effects: [],
    risk_level: "low",
  },
  read_file: {
    name: "read_file",
    description: "Read a file from the filesystem",
    side_effects: [],
    risk_level: "low",
  },
  write_file: {
    name: "write_file",
    description: "Write content to a file",
    side_effects: ["write"],
    risk_level: "medium",
  },
  send_email: {
    name: "send_email",
    description: "Send an email to a recipient",
    side_effects: ["send", "external_api"],
    risk_level: "medium",
  },
  publish_content: {
    name: "publish_content",
    description: "Publish content to a public channel",
    side_effects: ["publish", "external_api"],
    risk_level: "high",
  },
  deploy_code: {
    name: "deploy_code",
    description: "Deploy code to production environment",
    side_effects: ["deploy", "production"],
    risk_level: "high",
  },
  execute_shell: {
    name: "execute_shell",
    description: "Execute a shell command",
    side_effects: ["deploy", "shell"],
    risk_level: "high",
  },
  delete_data: {
    name: "delete_data",
    description: "Delete data from the system",
    side_effects: ["delete", "data_modification"],
    risk_level: "high",
  },
};

export class Stage0ToolGate {
  private client: Stage0Client;
  private context: RuntimeContext;
  private onDecision?: (tool: string, response: PolicyResponse) => void;
  private executionLog: Array<{
    tool: string;
    goal: string;
    response: PolicyResponse;
    timestamp: Date;
  }> = [];

  constructor(config: AgentConfig) {
    this.client = config.stage0Client;
    this.context = config.defaultContext ?? {};
    this.onDecision = config.onDecision;
  }

  async checkToolExecution(options: {
    toolName: string;
    goal: string;
    success_criteria?: string[];
    constraints?: string[];
    arguments?: Record<string, unknown>;
    context?: RuntimeContext;
  }): Promise<PolicyResponse> {
    const tool = TOOL_DEFINITIONS[options.toolName];
    if (!tool) {
      return this.createUnknownToolResponse(options.toolName);
    }

    const mergedContext: RuntimeContext = {
      ...this.context,
      ...options.context,
    };

    const response = await this.client.checkGoal({
      goal: options.goal,
      success_criteria: options.success_criteria ?? [],
      constraints: options.constraints ?? [],
      tools: [options.toolName],
      side_effects: tool.side_effects,
      context: mergedContext,
    });

    this.executionLog.push({
      tool: options.toolName,
      goal: options.goal,
      response,
      timestamp: new Date(),
    });

    this.onDecision?.(options.toolName, response);

    return response;
  }

  async executeWithGate(options: {
    toolName: string;
    goal: string;
    success_criteria?: string[];
    constraints?: string[];
    arguments?: Record<string, unknown>;
    context?: RuntimeContext;
    executor: () => Promise<string>;
  }): Promise<ToolCallResult> {
    const response = await this.checkToolExecution({
      toolName: options.toolName,
      goal: options.goal,
      success_criteria: options.success_criteria,
      constraints: options.constraints,
      arguments: options.arguments,
      context: options.context,
    });

    if (response.verdict === Verdict.DENY) {
      return {
        success: false,
        output: "",
        stage0_response: response,
        skipped: true,
        blocked: true,
        block_reason: response.reason,
      };
    }

    if (response.verdict === Verdict.DEFER) {
      return {
        success: false,
        output: "",
        stage0_response: response,
        skipped: true,
        blocked: true,
        block_reason: `DEFER: ${response.reason}`,
      };
    }

    try {
      const output = await options.executor();
      return {
        success: true,
        output,
        stage0_response: response,
      };
    } catch (error) {
      return {
        success: false,
        output: "",
        stage0_response: response,
        blocked: false,
        block_reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getExecutionLog(): Array<{
    tool: string;
    goal: string;
    response: PolicyResponse;
    timestamp: Date;
  }> {
    return [...this.executionLog];
  }

  getBlockedCalls(): Array<{
    tool: string;
    goal: string;
    response: PolicyResponse;
    timestamp: Date;
  }> {
    return this.executionLog.filter(
      (entry) =>
        entry.response.verdict === Verdict.DENY ||
        entry.response.verdict === Verdict.DEFER
    );
  }

  getAllowedCalls(): Array<{
    tool: string;
    goal: string;
    response: PolicyResponse;
    timestamp: Date;
  }> {
    return this.executionLog.filter(
      (entry) => entry.response.verdict === Verdict.ALLOW
    );
  }

  private createUnknownToolResponse(toolName: string): PolicyResponse {
    return {
      decision: Decision.NO_GO,
      verdict: Verdict.DENY,
      issues: [
        {
          code: "UNKNOWN_TOOL",
          severity: "HIGH",
          message: `Tool '${toolName}' is not registered in the tool definitions`,
        },
      ],
      risk_score: 100,
      high_risk: true,
      value_risk: 0,
      waste_risk: 0,
      clarifying_questions: [],
      guardrails: [],
      guardrail_checks: {},
      value_findings: [],
      defer_questions: [],
      request_id: "",
      policy_pack_version: "",
      policy_version: "",
      timestamp: Date.now() / 1000,
      evaluated_at: Date.now() / 1000,
      decision_trace_summary: "",
      cached: false,
      meta: {},
      cost_estimate: null,
      reason: `Unknown tool: ${toolName}`,
      raw_response: {},
    };
  }
}