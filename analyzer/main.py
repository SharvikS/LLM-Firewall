from fastapi import FastAPI
from analyzer.api.routes import router
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")

app = FastAPI(
    title="Titan ASR V2 (Agent Security Runtime)", 
    version="2.0.0",
    description="Enterprise API for isolating and evaluating autonomous agent tool executions."
)

app.include_router(router, prefix="/api/v2/asr")

@app.get("/health")
def health():
    return {"status": "TITAN_ASR_ONLINE", "version": "v2.0.0"}
