import ctypes
from ctypes import wintypes
from pathlib import Path
import sys


class _DataBlob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]


def decrypt_current_user_secret(path: Path) -> str:
    encrypted = path.read_bytes()
    if sys.platform != "win32":
        raise RuntimeError("Windows DPAPI is required")
    if not encrypted:
        raise ValueError("encrypted token is empty")
    source = ctypes.create_string_buffer(encrypted)
    source_blob = _DataBlob(len(encrypted), ctypes.cast(source, ctypes.POINTER(ctypes.c_byte)))
    output_blob = _DataBlob()
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    ok = crypt32.CryptUnprotectData(
        ctypes.byref(source_blob), None, None, None, None, 0, ctypes.byref(output_blob)
    )
    if not ok:
        raise RuntimeError("unable to decrypt Telegram token for this Windows user")
    try:
        clear = ctypes.string_at(output_blob.pbData, output_blob.cbData)
        token = clear.decode("utf-8")
    finally:
        kernel32.LocalFree(output_blob.pbData)
    if not token or any(ch.isspace() for ch in token):
        raise ValueError("decrypted Telegram token is invalid")
    return token
