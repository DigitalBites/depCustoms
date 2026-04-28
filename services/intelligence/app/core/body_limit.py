from __future__ import annotations

import json
from collections.abc import Awaitable, Callable

from .errors import error_payload

ASGIApp = Callable[
    [dict, Callable[[], Awaitable[dict]], Callable[[dict], Awaitable[None]]],
    Awaitable[None],
]


class RequestBodyTooLarge(Exception):
    pass


class BodyLimitMiddleware:
    def __init__(self, app: ASGIApp, limit_bytes: int) -> None:
        self.app = app
        self.limit_bytes = limit_bytes

    async def __call__(self, scope: dict, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        for name, value in scope.get("headers", []):
            if name != b"content-length":
                continue
            try:
                content_length = int(value.decode("latin-1"))
            except ValueError:
                break
            if content_length > self.limit_bytes:
                await self._send_too_large(send)
                return
            break

        total_bytes = 0

        async def limited_receive() -> dict:
            nonlocal total_bytes
            message = await receive()
            if message["type"] == "http.request":
                total_bytes += len(message.get("body", b""))
                if total_bytes > self.limit_bytes:
                    raise RequestBodyTooLarge
            return message

        try:
            await self.app(scope, limited_receive, send)
        except RequestBodyTooLarge:
            await self._send_too_large(send)

    async def _send_too_large(self, send) -> None:
        payload = error_payload(
            code="request_too_large",
            message="Request body exceeded the configured limit.",
            detail=None,
        )
        body = json.dumps(payload).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode("ascii")),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
