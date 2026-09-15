#!/usr/bin/env python3
"""Refresh usage for known sessions without replaying hooks or prompts."""
import importlib.util
import json
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location('session_hook', Path(__file__).with_name('session-hook.py'))
hook = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hook)
known = json.loads(Path(sys.argv[1]).read_text())
known = {s['sessionId']: s for s in known if s.get('host') == hook.HOST}
paths = {}
state_path = hook.ROOT / 'codex-observer-state.json'
if state_path.exists():
    for path, row in json.loads(state_path.read_text()).get('files', {}).items():
        if row.get('sessionId') in known and Path(path).exists(): paths[row['sessionId']] = path
for path in (Path.home() / '.claude/projects').glob('**/*.jsonl'):
    if path.stem in known: paths[path.stem] = str(path)
for sid, path in paths.items():
    try:
        state, complete = hook.scan(path, known[sid]['agentType'])
        while not complete:
            previous = state['offset']
            state, complete = hook.scan(path, known[sid]['agentType'])
            if state['offset'] == previous: break
        hook.collect_results(path, known[sid]['agentType'], {'session_id':sid,'host_name':hook.HOST}, True)
        result = hook.post('/telemetry', {'session_id':sid,'host_name':hook.HOST,'model':state.get('model'),'telemetry':state.get('telemetry'),'observed_at':state.get('modelUpdatedAt')})
        print(json.dumps({'sessionId':sid,'host':hook.HOST,'reported':result.get('ok'),'model':state.get('model'),'tokens':(state.get('telemetry') or {}).get('totalTokens')}),flush=True)
    except (OSError,ValueError) as error:
        print(json.dumps({'sessionId':sid,'error':type(error).__name__}),flush=True)
