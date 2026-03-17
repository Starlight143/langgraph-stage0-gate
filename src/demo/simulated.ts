import { Verdict, Decision, type PolicyResponse, type RuntimeContext } from "../stage0/index.js";

function generateRequestId(): string {
  return `sim_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export function simulateStage0Response(options: {
  side_effects: string[];
  context?: RuntimeContext;
}): PolicyResponse {
  const { side_effects, context } = options;
  const requestId = generateRequestId();
  const policyVersion = "v1.0.0-simulated";

  const hasHighRiskSideEffects = side_effects.some(
    (s) => ["deploy", "publish", "delete", "production", "execute"].includes(s)
  );

  const hasProductionContext = context?.environment === "production";
  const hasNoApproval = context?.approval_status === undefined || context?.approval_status === "pending";

  if (hasHighRiskSideEffects && (hasProductionContext || hasNoApproval)) {
    return {
      decision: Decision.NO_GO,
      verdict: Verdict.DENY,
      issues: [
        {
          code: "SIDE_EFFECTS_NEED_GUARDRAILS",
          severity: "HIGH",
          message: `Side effects [${side_effects.join(", ")}] require explicit approval or guardrails`,
        },
      ],
      risk_score: 85,
      high_risk: true,
      value_risk: 30,
      waste_risk: 40,
      clarifying_questions: [],
      guardrails: ["approval_required", "audit_logging"],
      guardrail_checks: { approval_required: false },
      value_findings: [],
      defer_questions: [],
      request_id: requestId,
      policy_pack_version: policyVersion,
      policy_version: policyVersion,
      timestamp: Date.now() / 1000,
      evaluated_at: Date.now() / 1000,
      decision_trace_summary: "High-risk side effects detected without proper guardrails",
      cached: false,
      meta: { simulated: true },
      cost_estimate: null,
      reason: `HIGH severity: SIDE_EFFECTS_NEED_GUARDRAILS - '${side_effects.join(", ")}' side effect requires explicit approval`,
      raw_response: { simulated: true },
    };
  }

  if (side_effects.length > 0 && !hasHighRiskSideEffects) {
    return {
      decision: Decision.GO,
      verdict: Verdict.ALLOW,
      issues: [],
      risk_score: 35,
      high_risk: false,
      value_risk: 10,
      waste_risk: 15,
      clarifying_questions: [],
      guardrails: ["audit_logging"],
      guardrail_checks: { audit_logging: true },
      value_findings: ["Action has clear business value"],
      defer_questions: [],
      request_id: requestId,
      policy_pack_version: policyVersion,
      policy_version: policyVersion,
      timestamp: Date.now() / 1000,
      evaluated_at: Date.now() / 1000,
      decision_trace_summary: "Medium-risk action allowed with logging",
      cached: false,
      meta: { simulated: true },
      cost_estimate: null,
      reason: "Medium-risk side effects with proper context, allowed with audit",
      raw_response: { simulated: true },
    };
  }

  return {
    decision: Decision.GO,
    verdict: Verdict.ALLOW,
    issues: [],
    risk_score: 10,
    high_risk: false,
    value_risk: 5,
    waste_risk: 5,
    clarifying_questions: [],
    guardrails: [],
    guardrail_checks: {},
    value_findings: ["Action is informational and safe"],
    defer_questions: [],
    request_id: requestId,
    policy_pack_version: policyVersion,
    policy_version: policyVersion,
    timestamp: Date.now() / 1000,
    evaluated_at: Date.now() / 1000,
    decision_trace_summary: "Low-risk informational action",
    cached: false,
    meta: { simulated: true },
    cost_estimate: null,
    reason: "No high-risk side effects detected, safe to proceed",
    raw_response: { simulated: true },
  };
}