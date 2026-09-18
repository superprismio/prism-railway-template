import copy
import unittest
from community_memory.relationship_pilot import candidate, candidates, request_for, materialize, CRITERIA


class RelationshipPilotTests(unittest.TestCase):
    def setUp(self):
        self.record={'record_id':'r','revision':'v','meeting_id':'m',
          'content':'Zoë attended.\n- Write notes: Prepare release notes. (owner: Zoë)',
          'metadata':{'action_items':[{'name':'Write notes','assignedTo':'Zoë'}]}}
        self.batch={'generation':'g','summary':self.record['content'],'candidates':candidates(self.record)}
        self.response={'model':'test', 'answers':{'kind_0':{'type':'choice','choice':'action',
          'probabilities':{k:1 if k=='action' else 0 for k in CRITERIA}},'owner_0':{'type':'noul','noul':.95}}}

    def test_malformed_action_items_are_skipped(self):
        good = self.record['metadata']['action_items'][0]
        for bad in [None, 12, {}, [], '', '   ']:
            self.record['metadata']['action_items'] = [{'name': bad}, good]
            self.assertEqual(len(candidates(self.record)), 1)
        self.record['metadata']['action_items'] = 12
        self.assertEqual(candidates(self.record), [])

    def test_unlinked_meetings_cannot_create_edges(self):
        for missing in [None, '', '  ', 123]:
            self.record['meeting_id'] = missing
            self.assertEqual(candidates(self.record), [])
            with self.assertRaises(ValueError):
                candidate(self.record, 'Zoë attended.')
            self.batch['candidates'][0]['meeting_id'] = missing
            with self.assertRaises(ValueError):
                materialize(self.batch, self.response)

    def test_candidates_reuse_upstream_owner_and_exact_unicode_evidence(self):
        c=self.batch['candidates'][0]
        self.assertEqual(c['owner_candidate'],'Zoë')
        self.assertEqual(self.record['content'][c['start']:c['end']],c['quote'])
        self.assertEqual(c['upstream_baseline']['kind'],'action')

    def test_no_fuzzy_invented_action(self):
        self.record['metadata']['action_items'][0]['name']='Invented'
        self.assertEqual(candidates(self.record),[])

    def test_quote_required(self):
        with self.assertRaises(ValueError): candidate(self.record,'invented')

    def test_questions_exclude_expected_labels(self):
        self.batch['candidates'][0]['expected']={'kind':'action'}
        self.assertNotIn('expected', str(request_for(self.batch)))
        self.assertEqual(len(request_for(self.batch)['questions']),2)

    def test_owner_edge_requires_both_judgments(self):
        self.assertTrue(any(e['predicate']=='assigned_to_action' for e in materialize(self.batch,self.response)['edges']))
        self.response['answers']['owner_0']['noul']=.1
        self.assertFalse(any(e['predicate']=='assigned_to_action' for e in materialize(self.batch,self.response)['edges']))

    def test_unowned_action_does_not_get_owner_from_participants(self):
        self.batch['candidates'][0]['owner_candidate']=None
        self.assertNotIn('owner_0',request_for(self.batch)['questions'])
        self.assertFalse(any(e['predicate']=='assigned_to_action' for e in materialize(self.batch,self.response)['edges']))

    def test_ambiguous_classification_abstains(self):
        a=self.response['answers']['kind_0'];a['probabilities']['action']=.6;a['probabilities']['proposal']=.4
        output=materialize(self.batch,self.response)
        self.assertTrue(output['judgments'][0]['abstained'])
        self.assertEqual(len(output['edges']),1)

    def test_nonaction_cannot_create_owner(self):
        a=self.response['answers']['kind_0'];a['choice']='proposal';a['probabilities']={k:int(k=='proposal') for k in CRITERIA}
        self.assertFalse(any(e['predicate']=='assigned_to_action' for e in materialize(self.batch,self.response)['edges']))

    def test_changed_quote_rejected(self):
        self.batch['summary']='changed'
        with self.assertRaises(ValueError): materialize(self.batch,self.response)

    def test_bad_probabilities_rejected(self):
        for value in [float('nan'),float('inf'),-1,1.1,True]:
            with self.subTest(value=value):
                r=copy.deepcopy(self.response);r['answers']['owner_0']['noul']=value
                with self.assertRaises(ValueError): materialize(self.batch,r)

    def test_missing_answer_rejected(self):
        del self.response['answers']['owner_0']
        with self.assertRaises(KeyError): materialize(self.batch,self.response)

    def test_all_edges_carry_revision_and_experimental_marker(self):
        for edge in materialize(self.batch,self.response)['edges']:
            self.assertEqual(edge['evidence']['revision'],'v')
            self.assertTrue(edge['experimental'])
            self.assertEqual(edge['authority'],'retained-summary-only')
