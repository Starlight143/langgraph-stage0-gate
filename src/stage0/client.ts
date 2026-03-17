/**
 * Stage0 API Client for TypeScript
 *
 * This client integrates with the SignalPulse Stage0 runtime to provide
 * policy validation before tool execution in LangGraph agents.
 */

import { v4 as uuidv4 } from "uuid";

// ============================================================================
// Types and Enums
// ============================================================================

/**
 * Stage0 decision types returned by the API
 */
export enum Decision {
  GO = "GO",
  NO_GO = "NO_GO",
  DEFER = "DEFER",
  ERROR = "ERROR",
}

/**
 * Stage0 verdict types for execution control
 */
export enum Verdict {
  ALLOW = "ALLOW",
  DENY = "DENY",
  DEFER = "DEFER",
}

/**
 * Cost estimate returned by Stage0 (optional)
 */
export interface CostEstimate {
  currency: string;
  min: number;
  max: number;
  assumptions: string[];
}

/**
 * Issue detected during policy evaluation
 */
export interface Stage0Issue {
  code: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Response from a Stage0 policy check
 */
export interface PolicyResponse {
  decision: Decision;
  verdict: Verdict;
  issues: Stage0Issue[];
  risk_score: number;
  high_risk: boolean;
  value_risk: number;
  waste_risk: number;
  clarifying_questions: string[];
  guardrails: string[];
  guardrail_checks: Record<string, unknown>;
  value_findings: string[];
  defer_questions: string[];
  request_id: string;
  policy_pack_version: string;
  policy_version: string;
  timestamp: number;
  evaluated_at: number;
  decision_trace_summary: string;
  cached: boolean;
  meta: Record<string, unknown>;
  cost_estimate: CostEstimate | null;
  reason: string;
  raw_response: Record<string, unknown>;
}

/**
 * Runtime context for Stage0 evaluation
 */
export interface RuntimeContext {
  actor_role?: string;
  approval_status?: "approved" | "pending" | "rejected";
  environment?: "development" | "staging" | "production";
  request_channel?: string;
  loop_state?: {
    run_id: string;
    retry_count: number;
    elapsed_seconds: number;
    repeated_tools: string[];
  };
  [key: string]: unknown;
}

/**
 * Execution intent to be validated by Stage0
 */
export interface ExecutionIntent {
  goal: string;
  success_criteria: string[];
  constraints: string[];
  tools: string[];
  side_effects: string[];
  context: RuntimeContext;
  pro: boolean;
}

/**
 * Configuration for Stage0 client
 */
export interface Stage0ClientConfig {
  apiKey?: string;
  baseUrl?: string;
  riskThreshold?: number;
  denyOnIssues?: boolean;
}

// ============================================================================
// Stage0 Client
// ============================================================================

/**
 * Client for Stage0 runtime policy validation.
 *
 * Stage0 is the runtime policy authority and must be treated as
 * the final decision maker. All execution intents must be validated
 * through this client before execution.
 */
export class Stage0Client {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly riskThreshold: number;
  private readonly denyOnIssues: boolean;

  static readonly DEFAULT_BASE_URL = "https://api.signalpulse.org";
  static readonly CHECK_ENDPOINT = "/check";

  constructor(config: Stage0ClientConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.STAGE0_API_KEY ?? "";
    if (!this.apiKey) {
      throw new Error(
        "Stage0 API key is required. Set STAGE0_API_KEY environment variable or pass apiKey in config."
      );
    }
    this.baseUrl =
      config.baseUrl ?? process.env.STAGE0_BASE_URL ?? Stage0Client.DEFAULT_BASE_URL;
    this.riskThreshold = config.riskThreshold ?? 100;
    this.denyOnIssues = config.denyOnIssues ?? false;
  }

  /**
   * Validate an execution intent with Stage0
   */
  async check(intent: ExecutionIntent): Promise<PolicyResponse> {
    const url = `${this.baseUrl}${Stage0Client.CHECK_ENDPOINT}`;
    const requestId = uuidv4();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
      "X-Request-Id": requestId,
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(this.intentToRequestBody(intent)),
      });

      if (response.status === 402) {
        return this.handleProRequired(response, intent, requestId);
      }

      if (!response.ok) {
        return this.handleHttpError(response, intent, requestId);
      }

      const data = await response.json();
      let policyResponse = this.parsePolicyResponse(
        data as Record<string, unknown>,
        requestId
      );

      if (policyResponse.verdict === Verdict.ALLOW) {
        policyResponse = this.applyLocalRules(policyResponse);
      }

      return policyResponse;
    } catch (error) {
      return {
        decision: Decision.ERROR,
        verdict: Verdict.DENY,
        issues: [],
        risk_score: 0,
        high_risk: false,
        value_risk: 0,
        waste_risk: 0,
        clarifying_questions: [],
        guardrails: [],
        guardrail_checks: {},
        value_findings: [],
        defer_questions: [],
        request_id: requestId,
        policy_pack_version: "",
        policy_version: "",
        timestamp: 0,
        evaluated_at: 0,
        decision_trace_summary: "",
        cached: false,
        meta: {},
        cost_estimate: null,
        reason: `Stage0 validation failed: ${error instanceof Error ? error.message : String(error)}`,
        raw_response: { error: String(error), request_id: requestId },
      };
    }
  }

  /**
   * Convenience method to check a goal directly
   */
  async checkGoal(options: {
    goal: string;
    success_criteria?: string[];
    constraints?: string[];
    tools?: string[];
    side_effects?: string[];
    context?: RuntimeContext;
    pro?: boolean;
  }): Promise<PolicyResponse> {
    const intent: ExecutionIntent = {
      goal: options.goal,
      success_criteria: options.success_criteria ?? [],
      constraints: options.constraints ?? [],
      tools: options.tools ?? [],
      side_effects: options.side_effects ?? [],
      context: options.context ?? {},
      pro: options.pro ?? false,
    };
    return this.check(intent);
  }

  private intentToRequestBody(intent: ExecutionIntent): Record<string, unknown> {
    return {
      goal: intent.goal,
      success_criteria: intent.success_criteria,
      constraints: intent.constraints,
      tools: intent.tools,
      side_effects: intent.side_effects,
      context: intent.context,
      pro: intent.pro,
    };
  }

  private parsePolicyResponse(
    data: Record<string, unknown>,
    requestId: string
  ): PolicyResponse {
    const verdict = parseVerdict(data["verdict"]);
    const decision = parseDecision(data["decision"]);
    const issues = ensureIssueList(data["issues"]);
    const clarifying = ensureStringList(data["clarifying_questions"]);
    const deferQuestions = ensureStringList(data["defer_questions"] ?? clarifying);
    const policyPackVersion = String(
      data["policy_pack_version"] ?? data["policy_version"] ?? ""
    );
    const policyVersion = String(data["policy_version"] ?? policyPackVersion);
    const timestamp = Number(data["timestamp"] ?? 0);
    const evaluatedAt = Number(data["evaluated_at"] ?? timestamp);
    const decisionTraceSummary = String(data["decision_trace_summary"] ?? "");

    let reason = data["reason"];
    if (!reason && issues.length > 0) {
      const issueMessages = issues.map(
        (i) => `${i.code}: ${i.message}`
      );
      reason = issueMessages.join("; ");
    }
    if (!reason && decisionTraceSummary) {
      reason = decisionTraceSummary;
    }
    if (!reason) {
      reason = "No reason provided";
    }

    const costEstimateData = data["cost_estimate"];
    let costEstimate: CostEstimate | null = null;
    if (typeof costEstimateData === "object" && costEstimateData !== null) {
      costEstimate = {
        currency: String((costEstimateData as Record<string, unknown>)["currency"] ?? "USD"),
        min: Number((costEstimateData as Record<string, unknown>)["min"] ?? 0),
        max: Number((costEstimateData as Record<string, unknown>)["max"] ?? 0),
        assumptions: ensureStringList((costEstimateData as Record<string, unknown>)["assumptions"]),
      };
    }

    const metaData = data["meta"];
    const meta = typeof metaData === "object" && metaData !== null
      ? metaData as Record<string, unknown>
      : {};

    return {
      decision,
      verdict,
      issues,
      risk_score: Number(data["risk_score"] ?? 0),
      high_risk: Boolean(data["high_risk"]),
      value_risk: Number(data["value_risk"] ?? 0),
      waste_risk: Number(data["waste_risk"] ?? 0),
      clarifying_questions: clarifying,
      guardrails: ensureStringList(data["guardrails"]),
      guardrail_checks: ensureRecord(data["guardrail_checks"]),
      value_findings: ensureStringList(data["value_findings"]),
      defer_questions: deferQuestions,
      request_id: String(data["request_id"] ?? requestId),
      policy_pack_version: policyPackVersion,
      policy_version: policyVersion,
      timestamp,
      evaluated_at: evaluatedAt,
      decision_trace_summary: decisionTraceSummary,
      cached: Boolean(data["cached"]),
      meta,
      cost_estimate: costEstimate,
      reason: String(reason),
      raw_response: data,
    };
  }

  private async handleProRequired(
    response: Response,
    intent: ExecutionIntent,
    requestId: string
  ): Promise<PolicyResponse> {
    const data = await this.safeJson(response);
    const detail = data["detail"] ?? "Pro checks require a paid plan";
    const reason =
      typeof detail === "object" && detail !== null
        ? String((detail as Record<string, unknown>)["detail"] ?? detail)
        : String(detail);
    const resolvedRequestId =
      typeof detail === "object" && detail !== null
        ? String((detail as Record<string, unknown>)["request_id"] ?? requestId)
        : String(data["request_id"] ?? requestId);

    return {
      decision: Decision.NO_GO,
      verdict: Verdict.DENY,
      issues: [
        {
          code: "PRO_PLAN_REQUIRED",
          severity: "HIGH",
          message: reason,
        },
      ],
      risk_score: 0,
      high_risk: false,
      value_risk: 0,
      waste_risk: 0,
      clarifying_questions: [],
      guardrails: [],
      guardrail_checks: {},
      value_findings: [],
      defer_questions: [],
      request_id: resolvedRequestId,
      policy_pack_version: "",
      policy_version: "",
      timestamp: 0,
      evaluated_at: 0,
      decision_trace_summary: "",
      cached: false,
      meta: {},
      cost_estimate: null,
      reason: `Stage0 Pro required: ${reason}`,
      raw_response: {
        status_code: 402,
        response: data,
        intent: this.intentToRequestBody(intent),
      },
    };
  }

  private async handleHttpError(
    response: Response,
    intent: ExecutionIntent,
    requestId: string
  ): Promise<PolicyResponse> {
    const data = await this.safeJson(response);
    const detail = data["detail"] ?? data;

    const reason =
      typeof detail === "object" && detail !== null
        ? String((detail as Record<string, unknown>)["detail"] ?? `HTTP ${response.status}`)
        : String(detail ?? `HTTP ${response.status}`);
    const resolvedRequestId =
      typeof detail === "object" && detail !== null
        ? String((detail as Record<string, unknown>)["request_id"] ?? requestId)
        : String(data["request_id"] ?? requestId);

    let verdict = Verdict.DENY;
    let decision = Decision.ERROR;
    const clarifyingQuestions: string[] = [];

    if (response.status === 429) {
      verdict = Verdict.DEFER;
      decision = Decision.DEFER;
      if (typeof detail === "object" && detail !== null) {
        const retryAfter = (detail as Record<string, unknown>)["retry_after_seconds"];
        if (retryAfter !== undefined) {
          clarifyingQuestions.push(
            `Retry after ${retryAfter} seconds or lower request volume.`
          );
        }
      }
    }

    return {
      decision,
      verdict,
      issues: [],
      risk_score: 0,
      high_risk: false,
      value_risk: 0,
      waste_risk: 0,
      clarifying_questions: clarifyingQuestions,
      guardrails: [],
      guardrail_checks: {},
      value_findings: [],
      defer_questions: clarifyingQuestions,
      request_id: resolvedRequestId,
      policy_pack_version: "",
      policy_version: "",
      timestamp: 0,
      evaluated_at: 0,
      decision_trace_summary: "",
      cached: false,
      meta: {},
      cost_estimate: null,
      reason,
      raw_response: {
        status_code: response.status,
        response: data,
        intent: this.intentToRequestBody(intent),
      },
    };
  }

  private applyLocalRules(response: PolicyResponse): PolicyResponse {
    if (response.risk_score >= this.riskThreshold) {
      return {
        ...response,
        verdict: Verdict.DENY,
        decision: Decision.NO_GO,
        reason: `Risk score (${response.risk_score}) exceeds threshold (${this.riskThreshold})`,
      };
    }

    if (this.denyOnIssues && hasHighSeverityIssues(response.issues)) {
      const firstIssue = response.issues[0]?.message ?? "Unknown issue";
      return {
        ...response,
        verdict: Verdict.DENY,
        decision: Decision.NO_GO,
        reason: `High severity issues detected: ${firstIssue}`,
      };
    }

    return response;
  }

  private async safeJson(response: Response): Promise<Record<string, unknown>> {
    try {
      const data = await response.json();
      return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function parseVerdict(value: unknown): Verdict {
  const token = String(value ?? "DENY").toUpperCase();
  if (token === "ALLOW") return Verdict.ALLOW;
  if (token === "DEFER") return Verdict.DEFER;
  return Verdict.DENY;
}

function parseDecision(value: unknown): Decision {
  const token = String(value ?? "ERROR").toUpperCase();
  if (token === "GO") return Decision.GO;
  if (token === "DEFER") return Decision.DEFER;
  if (token === "NO_GO") return Decision.NO_GO;
  return Decision.ERROR;
}

function ensureStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function ensureIssueList(value: unknown): Stage0Issue[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      code: String(item["code"] ?? "UNKNOWN"),
      severity: (item["severity"] as Stage0Issue["severity"]) ?? "MEDIUM",
      message: String(item["message"] ?? ""),
      details: item["details"] as Record<string, unknown> | undefined,
    }));
}

function ensureRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function hasHighSeverityIssues(issues: Stage0Issue[]): boolean {
  return issues.some((i) => i.severity === "HIGH" || i.severity === "CRITICAL");
}