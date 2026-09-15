#!/usr/bin/env python3
"""Collect transcript usage and emit queued feedback through agent hooks."""
import fcntl
import hashlib
import json
import os
import socket
import sys
import urllib.request
from pathlib import Path

ROOT = Path.home() / '.agentpulse'
ROOT.mkdir(exist_ok=True)
HOST = os.environ.get('AGENTPULSE_HOST_NAME') or socket.gethostname()
BASE = os.environ.get('AGENTPULSE_LOCAL_URL') or ((ROOT / 'local-api-url').read_text().strip() if (ROOT / 'local-api-url').exists() else 'http://127.0.0.1:43122/api/v1')

def post(path, body):
    headers = {'Content-Type': 'application/json', 'X-Agent-Type': sys.argv[1] if len(sys.argv) > 1 else 'codex_cli'}
    auth = ROOT / 'hook-auth'
    if auth.exists():
        value = auth.read_text().strip()
        headers['Authorization'] = value.split(':', 1)[1].strip() if value.startswith('Authorization:') else value
    req = urllib.request.Request(BASE + path, json.dumps(body).encode(), headers, method='POST')
    with urllib.request.urlopen(req, timeout=5) as response:
        return json.load(response)

def number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0 else 0

def scan(path, agent_type):
    """Bounded incremental read; request IDs prevent Claude chunk double counts."""
    path = Path(path)
    state_dir = ROOT / 'usage-state'
    state_dir.mkdir(exist_ok=True)
    state_path = state_dir / (hashlib.sha256(str(path).encode()).hexdigest() + '.json')
    with state_path.with_suffix('.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            states = json.loads(state_path.read_text())
        except (FileNotFoundError, ValueError):
            try:
                legacy = json.loads((ROOT / 'usage-state.json').read_text())
                states = {str(path): legacy[str(path)]} if str(path) in legacy else {}
            except (FileNotFoundError, ValueError):
                states = {}
        state = states.get(str(path), {'offset': 0, 'requests': {}})
        size = path.stat().st_size
        if state['offset'] > size:
            state = {'offset': 0, 'requests': {}}
        with path.open('rb') as handle:
            handle.seek(state['offset'])
            raw = handle.read(8 * 1024 * 1024)
        end = raw.rfind(b'\n') + 1
        if len(raw) == 8 * 1024 * 1024 and not end:
            # Skip an oversized record rather than holding the agent hook open.
            end = len(raw)
        for line in raw[:end].splitlines():
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if not isinstance(entry, dict): continue
            payload = entry.get('payload') or {}
            if not isinstance(payload, dict): continue
            if entry.get('type') in ('session_meta', 'turn_context') and payload.get('model'):
                state['model'] = payload['model']
                state['modelUpdatedAt'] = entry.get('timestamp')
            if payload.get('type') == 'token_count' and isinstance(payload.get('info'), dict) and payload['info'].get('total_token_usage'):
                info = payload['info']; total = info['total_token_usage']; last = info.get('last_token_usage')
                state['telemetry'] = {
                    'inputTokens': number(total.get('input_tokens')),
                    'cachedInputTokens': number(total.get('cached_input_tokens')),
                    'cacheWriteTokens': number(total.get('cache_write_input_tokens')),
                    'outputTokens': number(total.get('output_tokens')),
                    'reasoningTokens': number(total.get('reasoning_output_tokens')),
                    'totalTokens': number(total.get('total_tokens')),
                    'contextTokens': number(last.get('input_tokens')) if last else None,
                    'contextWindow': info.get('model_context_window'),
                    'updatedAt': entry.get('timestamp'), 'source': 'codex_transcript',
                }
            message = entry.get('message') or {}
            if not isinstance(message, dict): continue
            if agent_type == 'claude_code' and entry.get('type') == 'assistant' and isinstance(message.get('usage'), dict):
                if message.get('model'): state['model'] = message['model']
                state['modelUpdatedAt'] = entry.get('timestamp')
                key = message.get('id') or entry.get('uuid')
                if not key: continue
                usage = message['usage']; previous = state['requests'].get(key, {})
                state['requests'][key] = {k: max(number(usage.get(k)), number(previous.get(k))) for k in ('input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens')}
                usage = state['requests'][key]
                counts = {k: sum(r.get(k, 0) for r in state['requests'].values()) for k in usage}
                context = usage['input_tokens'] + usage['cache_read_input_tokens'] + usage['cache_creation_input_tokens']
                state['telemetry'] = {
                    'inputTokens': counts['input_tokens'] + counts['cache_read_input_tokens'] + counts['cache_creation_input_tokens'],
                    'cachedInputTokens': counts['cache_read_input_tokens'], 'cacheWriteTokens': counts['cache_creation_input_tokens'],
                    'outputTokens': counts['output_tokens'], 'reasoningTokens': 0,
                    'totalTokens': sum(counts.values()), 'contextTokens': context, 'contextWindow': None,
                    'updatedAt': entry.get('timestamp'), 'source': 'claude_transcript',
                }
        state['offset'] += end
        states[str(path)] = state
        temporary = state_path.with_suffix('.tmp')
        temporary.write_text(json.dumps(states))
        temporary.replace(state_path)
        return state, state['offset'] >= size

def main():
    payload = json.load(sys.stdin)
    agent_type = sys.argv[1] if len(sys.argv) > 1 else 'codex_cli'
    sid = payload.get('session_id')
    if not sid: return
    common = {'session_id': sid, 'host_name': HOST}
    if '--telemetry-only' not in sys.argv and '--feedback-only' not in sys.argv:
        try:
            post('/hooks', {**payload, 'host_name': HOST})
        except (OSError, ValueError):
            pass
    path = payload.get('transcript_path')
    if path and Path(path).exists():
        try:
            state, complete = scan(path, agent_type)
            if '--telemetry-only' in sys.argv:
                while not complete:
                    previous_offset = state['offset']
                    state, complete = scan(path, agent_type)
                    if state['offset'] == previous_offset: break
            post('/telemetry', {**common, 'model': state.get('model'), 'telemetry': state.get('telemetry'), 'observed_at': state.get('modelUpdatedAt')})
        except (OSError, ValueError):
            pass
    if '--telemetry-only' in sys.argv: return
    event = payload.get('hook_event_name')
    if event not in ('PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'SessionStart'): return
    try:
        feedback = post('/feedback/claim', common).get('feedback', [])
        if not feedback: return
        text = '\n\n'.join('[User feedback ' + f['id'] + ']\n' + f['text'] for f in feedback)
        print(json.dumps({'hookSpecificOutput': {'hookEventName': event, 'additionalContext': text}}), flush=True)
        post('/feedback/ack', {**common, 'ids': [f['id'] for f in feedback]})
    except (OSError, ValueError):
        # Offline delivery remains queued or becomes eligible after lease expiry.
        return

if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, TypeError):
        pass
