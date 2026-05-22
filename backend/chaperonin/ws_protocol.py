"""Minimal RFC 6455 WebSocket framing — text + close only. Stdlib-only so the
server needs no third-party dependency. Pure functions; asyncio plumbing is in
server.py."""

from __future__ import annotations

import base64
import hashlib

_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def accept_key(client_key: str) -> str:
    digest = hashlib.sha1((client_key + _GUID).encode()).digest()
    return base64.b64encode(digest).decode()


def encode_text_frame(text: str) -> bytes:
    payload = text.encode("utf-8")
    header = bytearray([0x81])  # FIN + text opcode
    n = len(payload)
    if n < 126:
        header.append(n)
    elif n < (1 << 16):
        header.append(126)
        header += n.to_bytes(2, "big")
    else:
        header.append(127)
        header += n.to_bytes(8, "big")
    return bytes(header) + payload


def decode_frames(buf: bytes):
    """Decode complete frames; return (messages, remainder) where messages is a
    list of ("text"|"close", text) and remainder is the unconsumed tail."""
    messages = []
    i, n = 0, len(buf)
    while True:
        if n - i < 2:
            break
        b0, b1 = buf[i], buf[i + 1]
        opcode = b0 & 0x0F
        masked = bool(b1 & 0x80)
        length = b1 & 0x7F
        j = i + 2
        if length == 126:
            if n - j < 2:
                break
            length = int.from_bytes(buf[j:j + 2], "big"); j += 2
        elif length == 127:
            if n - j < 8:
                break
            length = int.from_bytes(buf[j:j + 8], "big"); j += 8
        mask = b""
        if masked:
            if n - j < 4:
                break
            mask = buf[j:j + 4]; j += 4
        if n - j < length:
            break
        payload = bytearray(buf[j:j + length])
        if masked:
            for k in range(length):
                payload[k] ^= mask[k % 4]
        j += length
        i = j
        if opcode == 0x8:
            messages.append(("close", ""))
        elif opcode in (0x1, 0x0):
            messages.append(("text", payload.decode("utf-8", errors="replace")))
    return messages, buf[i:]
