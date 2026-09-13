"""Install event-keyed Codex command hooks without replacing other hooks."""

import json
import os
from pathlib import Path
import sys
import tempfile


EVENTS = (
    "SessionStart", "PreToolUse", "PostToolUse", "UserPromptSubmit", "Stop",
    "SubagentStart", "SubagentStop", "PermissionRequest", "PreCompact", "PostCompact",
)


def write_private(path: Path, content: str, mode: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, "w") as output:
            output.write(content)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def install(codex_dir: Path, url: str, key: str) -> None:
    hooks_file = codex_dir / "hooks.json"
    data = json.loads(hooks_file.read_text()) if hooks_file.exists() else {}
    hooks = data.setdefault("hooks", {})
    if not isinstance(hooks, dict):
        raise ValueError(f"{hooks_file}: expected event-keyed hooks; refusing to replace existing configuration")

    agentpulse_dir = Path.home() / ".agentpulse"
    script = agentpulse_dir / "codex-hook.sh"
    command = f'bash "{script}"'
    for event in EVENTS:
        entries = hooks.setdefault(event, [])
        if not isinstance(entries, list):
            raise ValueError(f"{hooks_file}: invalid {event} hook entries")
        if not any(handler.get("command") == command for entry in entries if isinstance(entry, dict)
                   for handler in entry.get("hooks", []) if isinstance(handler, dict)):
            entries.append({"matcher": "", "hooks": [{"type": "command", "command": command, "async": True, "timeout": 5}]})

    # The command contains only a local script path. The credential stays in a
    # private header file, never in hooks.json, process arguments, or logs.
    write_private(agentpulse_dir / "codex-hook-url", url + "\n", 0o600)
    if key:
        write_private(agentpulse_dir / "codex-hook-auth", f"Authorization: Bearer {key}\n", 0o600)
    script_text = '''#!/usr/bin/env bash
set -euo pipefail
read -r hook_url < "$HOME/.agentpulse/codex-hook-url"
auth=()
if [[ -f "$HOME/.agentpulse/codex-hook-auth" && "${AGENTPULSE_HOOK_AUTH:-}" == "enabled" ]]; then
  auth=(-H "@$HOME/.agentpulse/codex-hook-auth")
fi
curl -fsS --max-time 5 -X POST -H 'Content-Type: application/json' -H 'X-Agent-Type: codex_cli' "${auth[@]}" --data-binary @- "$hook_url" >/dev/null
'''
    # An explicit flag avoids accidentally reusing a stale auth file when
    # switching from an authenticated server to a local, auth-free relay.
    script_text = script_text.replace('"${AGENTPULSE_HOOK_AUTH:-}" == "enabled"',
                                      '"enabled" == "enabled"' if key else '"disabled" == "enabled"')
    write_private(script, script_text, 0o700)
    write_private(hooks_file, json.dumps(data, indent=2) + "\n", 0o600)


if __name__ == "__main__":
    install(Path(sys.argv[1]), sys.argv[2], os.environ.get("AGENTPULSE_SETUP_KEY", ""))
