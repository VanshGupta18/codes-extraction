"""XSUAA client-credentials token for lookup-service → CAP in Cloud Foundry."""
import json
import os
import time

import httpx

_token: str | None = None
_token_expires_at: float = 0.0


def _xsuaa_credentials() -> dict | None:
    try:
        services = json.loads(os.environ.get("VCAP_SERVICES", "{}"))
    except json.JSONDecodeError:
        return None
    entries = services.get("xsuaa") or services.get("XSUAA") or []
    return entries[0].get("credentials") if entries else None


async def get_auth_headers() -> dict[str, str]:
    global _token, _token_expires_at

    creds = _xsuaa_credentials()
    if not creds:
        return {}

    if _token and time.time() < _token_expires_at - 60:
        return {"Authorization": f"Bearer {_token}"}

    token_url = creds.get("url", "").rstrip("/") + "/oauth/token"
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            token_url,
            data={"grant_type": "client_credentials"},
            auth=(creds["clientid"], creds["clientsecret"]),
        )
        resp.raise_for_status()
        payload = resp.json()

    _token = payload["access_token"]
    _token_expires_at = time.time() + int(payload.get("expires_in", 3600))
    return {"Authorization": f"Bearer {_token}"}
