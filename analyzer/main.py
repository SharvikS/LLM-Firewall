from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel
from typing import Dict, Any, List
import re
import logging

# Configure Enterprise Logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("AgentSecurityRuntime")

app = FastAPI(title="CyberFort ASR (Agent Security Runtime)", version="2.0.0")

class ToolCallRequest(BaseModel):
    agent_id: str
    tenant_id: str
    tool_name: str
    tool_arguments: Dict[str, Any]

class ToolCallResponse(BaseModel):
    allowed: bool
    risk_score: float
    reason: str
    mitigation_applied: bool

# --- SECURITY RULES ENGINE ---

# Dangerous bash commands that autonomous agents should never execute
DANGEROUS_COMMANDS = re.compile(r"(rm\s+-rf|mkfs|dd\s+if|:\|:|wget|curl.*\|.*sh|chmod\s+777|nc\s+-e)")

# Restricted file paths (e.g. protecting host machines from agent traversal)
RESTRICTED_PATHS = ["/etc/shadow", "/etc/passwd", "/root", "/var/log", "/home/admin/.ssh"]

def analyze_bash_execution(args: Dict[str, Any]) -> ToolCallResponse:
    """Sandbox check for Bash/Shell execution tools"""
    command = args.get("command", "").lower()
    
    if not command:
        return ToolCallResponse(allowed=True, risk_score=0.1, reason="No command provided", mitigation_applied=False)

    if DANGEROUS_COMMANDS.search(command):
        logger.warning(f"CRITICAL: Blocked dangerous bash command: {command}")
        return ToolCallResponse(allowed=False, risk_score=9.9, reason="Malicious command execution detected (e.g. rm -rf, fork bomb)", mitigation_applied=True)

    return ToolCallResponse(allowed=True, risk_score=1.5, reason="Command execution allowed", mitigation_applied=False)

def analyze_file_access(args: Dict[str, Any]) -> ToolCallResponse:
    """Sandbox check for File Read/Write tools"""
    path = args.get("path", "")
    
    for restricted in RESTRICTED_PATHS:
        if restricted in path:
            logger.warning(f"HIGH RISK: Blocked access to restricted path: {path}")
            return ToolCallResponse(allowed=False, risk_score=8.5, reason=f"Unauthorized access to restricted path: {restricted}", mitigation_applied=True)

    return ToolCallResponse(allowed=True, risk_score=1.0, reason="File access allowed", mitigation_applied=False)

# --- API ENDPOINTS ---

@app.post("/api/v1/analyze/tool-call", response_model=ToolCallResponse)
async def analyze_tool_call(request: ToolCallRequest):
    """
    Core ASR Endpoint: Intercepts an LLM Tool Call / MCP Request.
    Evaluates the blast radius and intent of the tool execution before it runs.
    """
    logger.info(f"Analyzing tool call '{request.tool_name}' for agent '{request.agent_id}'")
    
    # 1. Route to specific sandbox analyzers based on tool intent
    if request.tool_name in ["run_bash", "execute_shell", "cmd"]:
        return analyze_bash_execution(request.tool_arguments)
        
    elif request.tool_name in ["read_file", "write_file", "fs_access"]:
        return analyze_file_access(request.tool_arguments)
        
    elif request.tool_name in ["send_email", "http_request"]:
        # Example of a medium-risk tool that requires human approval in V2
        return ToolCallResponse(allowed=False, risk_score=6.0, reason="Outbound network calls require HITL (Human-in-the-loop) approval", mitigation_applied=True)
        
    # 2. Default Fallback
    return ToolCallResponse(
        allowed=True, 
        risk_score=2.0, 
        reason="Tool recognized and allowed by default policy", 
        mitigation_applied=False
    )

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "Agent Security Runtime"}
