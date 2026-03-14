import json
import os
from decimal import Decimal
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import boto3
from botocore.exceptions import BotoCoreError, ClientError

TABLE_NAME = os.getenv("TABLE_NAME", "")
SHARED_API_KEY = os.getenv("SHARED_API_KEY", "")
AUTH_MODE = os.getenv("AUTH_MODE", "hybrid").strip().lower()


dynamodb = boto3.resource("dynamodb")


def _json_default(value: Any) -> Any:
    if isinstance(value, Decimal):
        if value == value.to_integral_value():
            return int(value)
        return float(value)
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def _json_response(status_code: int, payload: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": {
            "content-type": "application/json",
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "OPTIONS,GET,POST",
            "access-control-allow-headers": "content-type,x-api-key",
        },
        "body": json.dumps(payload, default=_json_default),
    }


def _get_method(event: Dict[str, Any]) -> str:
    rc = event.get("requestContext") or {}
    http = rc.get("http") or {}
    return http.get("method") or event.get("httpMethod") or ""


def _get_path(event: Dict[str, Any]) -> str:
    return str(event.get("rawPath") or event.get("path") or "")


def _get_api_key(event: Dict[str, Any]) -> str:
    headers = event.get("headers") or {}
    return (
        headers.get("x-api-key")
        or headers.get("X-Api-Key")
        or headers.get("X-API-KEY")
        or ""
    )


def _get_cognito_user_id(event: Dict[str, Any]) -> str:
    authorizer = ((event.get("requestContext") or {}).get("authorizer") or {})

    jwt_sub = (((authorizer.get("jwt") or {}).get("claims") or {}).get("sub"))
    if jwt_sub:
        return str(jwt_sub)

    claims_sub = ((authorizer.get("claims") or {}).get("sub"))
    if claims_sub:
        return str(claims_sub)

    principal_id = authorizer.get("principalId")
    if principal_id:
        return str(principal_id)

    return ""


def _get_pk_value(user_id: str) -> str:
    return f"user#{str(user_id).strip()}"


def _resolve_auth(event: Dict[str, Any]) -> Dict[str, Any]:
    cognito_user_id = _get_cognito_user_id(event)
    api_key = _get_api_key(event)

    if AUTH_MODE == "cognito":
        if not cognito_user_id:
            return {"ok": False, "error": "Missing or invalid Cognito identity"}
        return {"ok": True, "userId": cognito_user_id, "authType": "cognito"}

    if AUTH_MODE == "shared":
        if not api_key or api_key != SHARED_API_KEY:
            return {"ok": False, "error": "Invalid API key"}
        return {"ok": True, "userId": "shared", "authType": "shared"}

    if cognito_user_id:
        return {"ok": True, "userId": cognito_user_id, "authType": "cognito"}

    if api_key and api_key == SHARED_API_KEY:
        return {"ok": True, "userId": "shared", "authType": "shared"}

    return {"ok": False, "error": "Unauthorized"}


def _parse_body(event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    body = event.get("body")
    if not body:
        return {}
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return None


def _table():
    return dynamodb.Table(TABLE_NAME)


def _read_snapshot(user_id: str) -> Optional[Dict[str, Any]]:
    result = _table().get_item(Key={"pk": _get_pk_value(user_id)})
    return result.get("Item")


def _write_snapshot(
    user_id: str,
    snapshot: Dict[str, Any],
    client_updated_at: Optional[str],
    base_server_updated_at: Optional[str],
) -> Dict[str, Any]:
    current = _read_snapshot(user_id)
    current_server_updated_at = (current or {}).get("serverUpdatedAt") or ""

    if current and current_server_updated_at != (base_server_updated_at or ""):
        return {
            "ok": False,
            "conflict": True,
            "snapshot": current.get("snapshot"),
            "serverUpdatedAt": current_server_updated_at,
        }

    server_updated_at = datetime.now(timezone.utc).isoformat()
    _table().put_item(
        Item={
            "pk": _get_pk_value(user_id),
            "snapshot": snapshot,
            "userId": user_id,
            "clientUpdatedAt": client_updated_at,
            "serverUpdatedAt": server_updated_at,
        }
    )
    return {"ok": True, "serverUpdatedAt": server_updated_at}


def lambda_handler(event: Dict[str, Any], _context: Any) -> Dict[str, Any]:
    if not TABLE_NAME:
        return _json_response(500, {"ok": False, "error": "Missing TABLE_NAME env"})

    if AUTH_MODE in {"shared", "hybrid"} and not SHARED_API_KEY:
        return _json_response(500, {"ok": False, "error": "Missing SHARED_API_KEY env"})

    method = _get_method(event)
    path = _get_path(event)

    if method == "OPTIONS":
        return _json_response(200, {"ok": True})

    auth = _resolve_auth(event)
    if not auth.get("ok"):
        return _json_response(401, {"ok": False, "error": auth.get("error") or "Unauthorized"})

    user_id = str(auth.get("userId"))

    try:
        if method == "POST" and path.endswith("/sync/push"):
            body = _parse_body(event)
            if body is None:
                return _json_response(400, {"ok": False, "error": "Invalid JSON payload"})

            snapshot = body.get("snapshot")
            client_updated_at = body.get("clientUpdatedAt")
            base_server_updated_at = body.get("baseServerUpdatedAt")

            if not isinstance(snapshot, dict):
                return _json_response(400, {"ok": False, "error": "Missing snapshot object"})

            write_result = _write_snapshot(
                user_id,
                snapshot,
                client_updated_at,
                base_server_updated_at,
            )
            if write_result.get("conflict"):
                return _json_response(
                    409,
                    {
                        "ok": False,
                        "conflict": True,
                        "error": "Sync conflict",
                        "snapshot": write_result.get("snapshot"),
                        "serverUpdatedAt": write_result.get("serverUpdatedAt"),
                        "authType": auth.get("authType"),
                    },
                )

            return _json_response(
                200,
                {
                    "ok": True,
                    "serverUpdatedAt": write_result.get("serverUpdatedAt"),
                    "authType": auth.get("authType"),
                },
            )

        if method == "GET" and path.endswith("/sync/pull"):
            query = event.get("queryStringParameters") or {}
            since = query.get("since") or ""
            item = _read_snapshot(user_id)

            if not item:
                return _json_response(200, {"ok": True, "snapshot": None, "serverUpdatedAt": None})

            server_updated_at = item.get("serverUpdatedAt")
            if since and server_updated_at and since >= server_updated_at:
                return _json_response(200, {"ok": True, "snapshot": None, "serverUpdatedAt": server_updated_at})

            return _json_response(
                200,
                {
                    "ok": True,
                    "snapshot": item.get("snapshot"),
                    "serverUpdatedAt": server_updated_at,
                    "authType": auth.get("authType"),
                },
            )

        return _json_response(404, {"ok": False, "error": "Route not found"})
    except (ClientError, BotoCoreError) as err:
        return _json_response(500, {"ok": False, "error": str(err)})
    except Exception as err:  # noqa: BLE001
        return _json_response(500, {"ok": False, "error": str(err)})
