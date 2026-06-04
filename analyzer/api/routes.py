from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, Any, Optional

from analyzer.core.risk_engine import RuntimeRiskEngine
from analyzer.core.sandbox import FirecrackerSandboxManager

router = APIRouter()
risk_engine = RuntimeRiskEngine()
sandbox = FirecrackerSandboxManager()

class AgentContext(BaseModel):
    execution_loop_count: int = 0
    previous_tool_failures: int = 0

class ToolExecutionRequest(BaseModel):
    agent_id: str
    tool_name: str
    tool_arguments: Dict[str, Any]
    agent_context: AgentContext

class ExecutionResponse(BaseModel):
    allowed: bool
    risk_scores: Dict[str, float]
    sandbox_output: Optional[str] = None
    human_approval_required: bool = False
    reason: str

@router.post("/execute", response_model=ExecutionResponse)
async def evaluate_and_execute(req: ToolExecutionRequest):
    # 1. Calculate Risk
    risk = risk_engine.calculate_risk(req.tool_name, req.tool_arguments, req.agent_context.dict())
    
    # 2. Human Approval Workflow (Titan Requirement)
    overall_risk = risk["overall_risk"]
    if overall_risk >= 8.0:
        return ExecutionResponse(
            allowed=False,
            risk_scores=risk,
            human_approval_required=False,
            reason="CRITICAL RISK: Automatically blocked by Titan policy."
        )
    elif overall_risk >= 5.0:
        return ExecutionResponse(
            allowed=False,
            risk_scores=risk,
            human_approval_required=True,
            reason="MEDIUM RISK: Suspended execution for Human-in-the-Loop (HITL) approval."
        )
        
    # 3. Sandbox Execution (If Allowed)
    output = None
    if req.tool_name in ["run_bash", "execute_shell", "cmd"]:
        cmd = req.tool_arguments.get("command", "")
        sandbox_res = sandbox.execute_in_sandbox(cmd)
        if sandbox_res["status"] == "error":
            return ExecutionResponse(allowed=False, risk_scores=risk, reason=f"Sandbox Error: {sandbox_res.get('error', 'unknown')}")
        output = sandbox_res["output"]
        
    return ExecutionResponse(
        allowed=True,
        risk_scores=risk,
        sandbox_output=output,
        reason="Execution allowed and completed within secure sandbox."
    )
