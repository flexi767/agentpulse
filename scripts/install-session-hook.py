#!/usr/bin/env python3
"""Install usage/feedback alongside existing AgentPulse hooks; preserve others."""
import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--local-url', required=True)
args = p.parse_args()
home = Path.home(); root = home / '.agentpulse'; root.mkdir(exist_ok=True)
stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
def backup(path):
    if path.exists(): shutil.copy2(path, path.with_name(path.name + '.before-feedback-' + stamp))

helper = root / 'session-hook.py'
if helper.resolve() != Path(__file__).with_name('session-hook.py').resolve(): shutil.copy2(Path(__file__).with_name('session-hook.py'), helper)
(root / 'local-api-url').write_text(args.local_url + '\n')
forward = root / 'forward-hook.sh'
if forward.exists():
    backup(forward)
    forward.write_text('#!/bin/bash\nexec python3 "$HOME/.agentpulse/session-hook.py" "$1"\n')
codex = root / 'codex-hook.sh'
if codex.exists():
    backup(codex)
    codex.write_text('#!/bin/bash\nexec python3 "$HOME/.agentpulse/session-hook.py" codex_cli\n')
for agent, path in [('codex_cli',home/'.codex/hooks.json'),('claude_code',home/'.claude/settings.json')]:
    if not path.exists(): continue
    data = json.loads(path.read_text()); hooks = data.setdefault('hooks', {})
    found = False
    for event, groups in hooks.items():
        for group in groups:
            for handler in group.get('hooks', []):
                command = handler.get('command', '')
                if 'forward-hook.sh' in command or 'codex-hook.sh' in command:
                    found = True
                    handler['timeout'] = 30
                    if agent == 'codex_cli' and event in ['PreToolUse','PostToolUse','UserPromptSubmit','SessionStart']:
                        handler['additionalContextLimit'] = 0
                    elif agent == 'codex_cli' and handler.get('additionalContextLimit') == 0:
                        handler.pop('additionalContextLimit',None)
    if not found:
        command = 'python3 "' + str(helper) + '" ' + agent + ' --feedback-only'
        for event in ['PreToolUse','UserPromptSubmit','SessionStart']:
            groups = hooks.setdefault(event, [])
            if not any(h.get('command') == command for g in groups for h in g.get('hooks', [])):
                groups.append({'matcher':'','hooks':[{'type':'command','command':command,'async':True,'timeout':30}]})
    backup(path)
    path.write_text(json.dumps(data, indent=2)+'\n')
print('Installed session usage and feedback hooks.')
