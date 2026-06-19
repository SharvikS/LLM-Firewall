import logging
from typing import Dict, Any

logger = logging.getLogger("RiskEngine")

class RuntimeRiskEngine:
    """
    Titan Mode: Advanced Behavioral Risk Engine.
    Evaluates Threat Score, Confidence Score, and Blast Radius for Autonomous Agents.
    """
    def calculate_risk(self, tool_name: str, args: Dict[str, Any], agent_context: Dict[str, Any]) -> Dict[str, float]:
        threat_score = 0.0
        blast_radius = 0.0
        
        # 1. Analyze Tool Type and Arguments
        if tool_name in ["run_bash", "execute_shell", "cmd"]:
            blast_radius = 9.0
            command = args.get("command", "").lower()
            if "rm -rf" in command or "mkfs" in command or "dd if=" in command:
                threat_score = 10.0
            elif "curl" in command or "wget" in command:
                threat_score = 7.5
        elif tool_name in ["read_file"]:
            blast_radius = 4.0
            path = args.get("path", "")
            if "/etc/" in path or "/root/" in path or ".ssh" in path:
                threat_score = 8.5
        elif tool_name in ["write_file"]:
            blast_radius = 6.0
        elif tool_name in ["send_email", "slack_message"]:
            blast_radius = 5.0
            threat_score = 3.0 # Outbound comms always carry baseline risk
        
        # 2. Analyze Agent Context (Goal Drift & Loop Detection)
        loop_count = agent_context.get("execution_loop_count", 0)
        if loop_count > 5:
            logger.warning(f"Recursive Execution Loop detected (count: {loop_count}). Escalating Threat Score.")
            threat_score += (loop_count * 0.5)
            
        previous_failures = agent_context.get("previous_tool_failures", 0)
        if previous_failures > 3:
            logger.warning("Agent is brute-forcing tool executions. Escalating Threat Score.")
            threat_score += 2.0

        # Calculate Final Risk
        final_threat = min(10.0, threat_score)
        final_overall = min(10.0, (final_threat * 0.7) + (blast_radius * 0.3))

        return {
            "threat_score": final_threat,
            "blast_radius": blast_radius,
            "confidence": 0.95, # Simulated ML confidence interval
            "overall_risk": final_overall
        }
