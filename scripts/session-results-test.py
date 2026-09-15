#!/usr/bin/env python3
import importlib.util
import tempfile
import unittest
from pathlib import Path
s=importlib.util.spec_from_file_location('results',Path(__file__).with_name('session-results.py'));r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
class ResultsTest(unittest.TestCase):
    def event(self,state,typ,payload,at='2026-09-15T10:00:00Z'):
        r.consume(state,{'type':typ,'payload':payload,'timestamp':at},'codex_cli')
    def test_native_turn_duration_diff_and_usage_dedup(self):
        state={};self.event(state,'event_msg',{'type':'task_started','turn_id':'t'})
        self.event(state,'turn_context',{'model':'gpt-5.6-sol'})
        self.event(state,'response_item',{'type':'message','role':'user','content':[{'type':'input_text','text':'Fix the parser'}]})
        e={'type':'item_completed','turn_id':'t','item':{'type':'FileChange','id':'edit','changes':{'parser.py':{'unified_diff':'@@ -1 +1 @@\n-old\n+new'}}}}
        self.event(state,'event_msg',e);self.event(state,'event_msg',e)
        u={'turn_id':'t','response_id':'response','usage':{'input_tokens':100,'cached_input_tokens':70,'output_tokens':20}}
        self.event(state,'token_usage_record',u);self.event(state,'token_usage_record',u)
        self.event(state,'event_msg',{'type':'task_complete','turn_id':'t','duration_ms':1208000},'2026-09-15T10:20:08Z')
        turn=state['turns']['t'];self.assertEqual(turn['durationMs'],1208000);self.assertEqual(turn['files'][0]['added'],1);self.assertEqual(turn['usage'][0]['inputTokens'],100);self.assertEqual(turn['usage'][0]['requests'],1)
    def test_native_user_prompt_replaces_injected_context_and_new_file_diff(self):
        state={};self.event(state,'event_msg',{'type':'task_started','turn_id':'t'})
        self.event(state,'response_item',{'type':'message','role':'user','content':[{'type':'input_text','text':'Injected configuration'}]})
        self.event(state,'event_msg',{'type':'item_completed','item':{'type':'UserMessage','content':[{'type':'text','text':'Fix it'}]}})
        self.event(state,'event_msg',{'type':'item_completed','item':{'type':'FileChange','id':'f','changes':{'new.py':{'type':'add','content':'one\ntwo\n'}}}})
        self.assertEqual(state['turns']['t']['prompts'],['Fix it']);self.assertEqual(state['turns']['t']['files'][0]['added'],2)
    def test_model_switch_and_steering(self):
        state={};self.event(state,'event_msg',{'type':'task_started','turn_id':'t'})
        for model,key in [('gpt-5.6-sol','a'),('gpt-6-astra','b')]:
            self.event(state,'turn_context',{'model':model});self.event(state,'token_usage_record',{'turn_id':'t','response_id':key,'usage':{'input_tokens':100,'output_tokens':5}})
        self.assertEqual([u['model'] for u in state['turns']['t']['usage']],['gpt-5.6-sol','gpt-6-astra'])
    def test_claude_cache_ttl_and_confirmed_edit(self):
        state={}
        r.consume(state,{'type':'user','uuid':'t','timestamp':'2026-09-15T10:00:00Z','message':{'content':'Fix it'}},'claude_code')
        e={'type':'assistant','timestamp':'2026-09-15T10:00:01Z','message':{'id':'m','model':'claude-sonnet-5','usage':{'input_tokens':5,'output_tokens':10,'cache_read_input_tokens':20,'cache_creation_input_tokens':30,'cache_creation':{'ephemeral_1h_input_tokens':10}},'content':[{'type':'tool_use','id':'edit','name':'Edit','input':{'file_path':'a.py','old_string':'old\n','new_string':'new\n'}}]}}
        r.consume(state,e,'claude_code');r.consume(state,e,'claude_code')
        r.consume(state,{'type':'user','timestamp':'2026-09-15T10:00:02Z','message':{'content':[{'type':'tool_result','tool_use_id':'edit','content':'ok'}]}},'claude_code')
        u=state['turns']['t']['usage'][0];self.assertEqual(u['inputTokens'],55);self.assertEqual(u['cacheWriteHourTokens'],10);self.assertEqual(u['requests'],1);self.assertIn('-old',state['turns']['t']['files'][0]['diff'])
    def test_partial_line_and_ack_revision(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);p=root/'rollout.jsonl';p.write_text('{"type":"session_meta"}')
            turns,complete,dest=r.scan(p,'codex_cli',root);self.assertTrue(complete);self.assertEqual(turns,[])
            state={'turns':{'t':{'updatedAt':'new'}},'changed':['t']};dest.write_text(__import__('json').dumps(state));r.ack(dest,{'t':'old'});self.assertEqual(__import__('json').loads(dest.read_text())['changed'],['t'])
if __name__=='__main__':unittest.main()
