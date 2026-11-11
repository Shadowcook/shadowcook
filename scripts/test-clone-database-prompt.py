"""Exercise the real interactive clone against the integration test's cluster."""

import os
import select
import subprocess
import sys
import termios
import time


def main() -> None:
    master: int
    slave: int
    master, slave = os.openpty()
    process: subprocess.Popen[bytes] = subprocess.Popen(
        ["bash", sys.argv[1], "--env-file", sys.argv[2], "--execute"],
        stdin=slave,
        stdout=slave,
        stderr=slave,
    )
    os.close(slave)
    transcript: bytearray = bytearray()
    offset: int = 0

    def await_text(expected: bytes) -> None:
        nonlocal offset
        deadline: float = time.monotonic() + 30
        while expected not in transcript[offset:]:
            if time.monotonic() > deadline:
                raise AssertionError(f"Timed out waiting for {expected!r}")
            ready: list[int] = select.select([master], [], [], 0.1)[0]
            if ready:
                chunk: bytes = os.read(master, 65536)
                if not chunk:
                    raise AssertionError("Clone exited before the password step completed")
                transcript.extend(chunk)
        offset = transcript.index(expected, offset) + len(expected)

    def enter_secret(secret: bytes) -> None:
        deadline: float = time.monotonic() + 5
        while termios.tcgetattr(master)[3] & termios.ECHO:
            if time.monotonic() > deadline:
                raise AssertionError("Password input is not hidden")
            time.sleep(0.01)
        os.write(master, secret + b"\n")

    try:
        await_text(b"New test password for all users (including admin@local): ")
        enter_secret(b"first-secret-value")
        await_text(b"Repeat password: ")
        enter_secret(b"other-secret-value")
        await_text(b"Passwords do not match.")
        await_text(b"New test password for all users (including admin@local): ")
        enter_secret(b"abc")
        await_text(b"Repeat password: ")
        enter_secret(b"abc")
        await_text(b"bits of estimated entropy")
        await_text(b"New test password for all users (including admin@local): ")
        enter_secret(b"eR7!vQ2#nL9@xC4$kM8%pT6&zA1*")
        await_text(b"Repeat password: ")
        enter_secret(b"eR7!vQ2#nL9@xC4$kM8%pT6&zA1*")
        assert b"Exporting source" not in transcript, "Copy started before password confirmation"
        await_text(b"Exporting source")
        await_text(b"Clone complete. Test passwords are set for all users; admin@local is ready.")
        assert process.wait(timeout=10) == 0
        for secret in [b"first-secret-value", b"other-secret-value", b"abc", b"eR7!vQ2#nL9@xC4$kM8%pT6&zA1*"]:
            assert secret not in transcript, "Password was echoed in terminal output"
        print("PASS: hidden interactive password, confirmation mismatch, policy rejection, retry, completion")
    finally:
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=10)
        os.close(master)


if __name__ == "__main__":
    main()
