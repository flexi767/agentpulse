import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('hook', Path(__file__).with_name('session-hook.py'))
hook = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hook)

class UsageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        hook.ROOT = Path(self.tmp.name)
        self.path = hook.ROOT / 'transcript.jsonl'

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, rows):
        self.path.write_text(''.join(json.dumps(r) + '\n' for r in rows))

    def test_codex_cumulative_and_context_are_distinct(self):
        self.write([{'type':'turn_context','payload':{'model':'example-model'}}, {'type':'event_msg','timestamp':'2026-09-15T00:00:00Z','payload':{'type':'token_count','info':{'total_token_usage':{'input_tokens':1000,'cached_input_tokens':700,'output_tokens':200,'reasoning_output_tokens':50,'total_tokens':1200},'last_token_usage':{'input_tokens':300},'model_context_window':2000}}}])
        state, complete = hook.scan(self.path, 'codex_cli')
        self.assertTrue(complete)
        self.assertEqual(state['model'], 'example-model')
        self.assertEqual(state['telemetry']['totalTokens'],1200)
        self.assertEqual(state['telemetry']['contextTokens'],300)
        self.assertEqual(hook.scan(self.path,'codex_cli')[0]['telemetry']['totalTokens'],1200)

    def test_claude_chunks_are_not_counted_twice(self):
        def row(output):
            return {'type':'assistant','timestamp':'2026-09-15T00:00:00Z','message':{'id':'request-1','model':'example-claude','usage':{'input_tokens':100,'cache_read_input_tokens':500,'cache_creation_input_tokens':50,'output_tokens':output}}}
        self.write([row(10),row(20)])
        state, _ = hook.scan(self.path,'claude_code')
        self.assertEqual(state['telemetry']['totalTokens'],670)
        self.assertEqual(state['telemetry']['contextTokens'],650)
        with self.path.open('a') as f: f.write(json.dumps(row(30))+'\n')
        state, _ = hook.scan(self.path,'claude_code')
        self.assertEqual(state['telemetry']['totalTokens'],680)

    def test_partial_record_waits_for_newline(self):
        self.path.write_text('{"type":"turn_context"')
        # Small partial writes must not be skipped before the producer finishes.
        state, _ = hook.scan(self.path,'codex_cli')
        self.assertEqual(state['offset'],0)

    def test_null_codex_usage_is_ignored(self):
        self.write([{'type':'event_msg','payload':{'type':'token_count','info':None}},None,{'message':'text'}])
        state, complete = hook.scan(self.path,'codex_cli')
        self.assertTrue(complete)
        self.assertNotIn('telemetry',state)

if __name__ == '__main__': unittest.main()
