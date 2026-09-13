"""Behavioral checks for the self-contained Codex hook installer."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


INSTALLER = Path(__file__).with_name("install-codex-hooks.py")


class CodexHookInstallTest(unittest.TestCase):
    def test_preserves_existing_hooks_and_streams_payload_without_exposing_key(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            codex = home / ".codex"
            codex.mkdir()
            original = {"description": "keep", "hooks": {"SessionStart": [
                {"hooks": [{"type": "command", "command": "echo existing"}]}
            ]}}
            (codex / "hooks.json").write_text(json.dumps(original))
            environment = {**os.environ, "HOME": str(home), "AGENTPULSE_SETUP_KEY": "ap_private_example"}
            command = [sys.executable, str(INSTALLER), str(codex), "http://localhost:43120/api/v1/hooks"]
            subprocess.run(command, env=environment, check=True)
            subprocess.run(command, env=environment, check=True)
            result = json.loads((codex / "hooks.json").read_text())
            self.assertEqual(result["description"], "keep")
            self.assertEqual(result["hooks"]["SessionStart"][0], original["hooks"]["SessionStart"][0])
            self.assertEqual(len(result["hooks"]["SessionStart"]), 2)
            for entries in result["hooks"].values():
                self.assertEqual(len([h for e in entries for h in e["hooks"] if h.get("command", "").endswith("codex-hook.sh\"")]), 1)
            self.assertNotIn("ap_private_example", (codex / "hooks.json").read_text())
            self.assertNotIn("ap_private_example", (home / ".agentpulse/codex-hook.sh").read_text())
            self.assertEqual((home / ".agentpulse/codex-hook-auth").stat().st_mode & 0o777, 0o600)

            # A fake curl confirms the command forwards Codex's JSON on stdin.
            fake_bin = home / "bin"
            fake_bin.mkdir()
            fake_curl = fake_bin / "curl"
            fake_curl.write_text('#!/bin/sh\ncat > "$HOME/payload.json"\n')
            fake_curl.chmod(0o700)
            subprocess.run(["bash", str(home / ".agentpulse/codex-hook.sh")], input=b'{"hook_event_name":"Stop"}',
                           env={**environment, "PATH": str(fake_bin) + os.pathsep + os.environ["PATH"]}, check=True)
            self.assertEqual(json.loads((home / "payload.json").read_text())["hook_event_name"], "Stop")

    def test_invalid_existing_shape_is_left_untouched(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            codex = home / ".codex"
            codex.mkdir()
            hooks = codex / "hooks.json"
            content = '{"hooks":[{"event":"Stop","type":"http"}]}'
            hooks.write_text(content)
            result = subprocess.run([sys.executable, str(INSTALLER), str(codex), "http://localhost:43120/api/v1/hooks"],
                                    env={**os.environ, "HOME": str(home)}, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(hooks.read_text(), content)


if __name__ == "__main__":
    unittest.main()
