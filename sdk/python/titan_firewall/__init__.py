"""TITAN Gateway Python SDK.

A thin, dependency-free client for the TITAN Gateway Admin API. Manage tenants,
API keys, ABAC policies and query audit logs programmatically.

    from titan_firewall import TitanClient

    titan = TitanClient("http://localhost:8080", admin_token="titan-admin-dev-secret")
    tenant = titan.create_tenant("acme-corp", tier="enterprise", rate_limit=600)
    issued = titan.create_key(tenant["id"], name="prod-key")
    print(issued["key"])  # raw key — shown once
"""

from .client import TitanClient, TitanError

__all__ = ["TitanClient", "TitanError"]
__version__ = "1.0.0"
