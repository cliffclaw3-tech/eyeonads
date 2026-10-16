import json,pathlib,tempfile,unittest
from unittest.mock import patch
from beta_publisher import BetaPublisher,REPOSITORY,RELEASE,SOURCE
from buddy import REQUIRED_CHECKS
from poll_worker import run_once,apply_proposal

class PublisherTests(unittest.TestCase):
    def test_production_and_other_project_targets_denied(self):
        for origin in ['https://eyeonads.com','https://eyeonads.vercel.app','http://eyeonads-isolated-beta.vercel.app','https://eyeonads-isolated-beta.vercel.app/?token=x','https://eyeonads-isolated-beta.vercel.app.evil.invalid']:
            with self.assertRaises(ValueError):BetaPublisher('github_pat_fixture',origin)
    def test_api_token_stays_in_one_beta_repository(self):
        publisher=BetaPublisher('github_pat_fixture','https://eyeonads-isolated-beta.vercel.app')
        class Response:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,*args):return b'{}'
        with patch.object(publisher.opener,'open',return_value=Response()) as network:
            publisher.api('/commits/main')
            request=network.call_args.args[0]
            self.assertEqual(request.full_url,'https://api.github.com/repos/'+REPOSITORY+'/commits/main')
            with self.assertRaises(ValueError):publisher.api('https://api.github.com/repos/customer/prod')
            self.assertEqual(network.call_count,1)
    def test_concurrent_release_change_prevents_promotion(self):
        publisher=BetaPublisher('github_pat_fixture','https://eyeonads-isolated-beta.vercel.app')
        with patch.object(publisher,'commit',return_value={'sha':'c'*40}),patch.object(publisher,'api') as api:
            with self.assertRaises(ValueError):publisher.promote('a'*40,'b'*40)
            api.assert_not_called()
    def test_rollback_creates_forward_restore_commit_only_on_beta_branch(self):
        publisher=BetaPublisher('github_pat_fixture','https://eyeonads-isolated-beta.vercel.app')
        def commit(ref):return {'sha':'b'*40} if ref==RELEASE else {'commit':{'tree':{'sha':'a'*40}}}
        with patch.object(publisher,'commit',side_effect=commit),patch.object(publisher,'api',return_value={'sha':'d'*40}) as api:
            self.assertEqual(publisher.rollback('b'*40,'a'*40),'d'*40)
            self.assertEqual(api.call_args_list[-1].args,('/git/refs/heads/beta-release','PATCH',{'sha':'d'*40,'force':False}))
    def test_unregistered_patch_cannot_reach_publisher(self):
        wrong="diff --git a/src/components/BetaReadyLabel.ts b/src/components/BetaReadyLabel.ts\n--- a/src/components/BetaReadyLabel.ts\n+++ b/src/components/BetaReadyLabel.ts\n@@ -1 +1 @@\n-old\n+new\n"
        with self.assertRaises(Exception):apply_proposal("export function betaReadyLabel(ready: boolean): string { return 'Checking'; }\n",wrong)

class PipelineTests(unittest.TestCase):
    def scenario(self,healthy=True,checks_pass=True):
        events=[];origin='https://eyeonads-isolated-beta.vercel.app'
        class Client:
            def request(self,action,value):
                events.append(action)
                if action=='claim':return {'job':{'id':'fixture','lease':'fixture-lease','description':'The status stays Checking; expected Ready.'},'policy':{'repository':REPOSITORY,'base_ref':RELEASE,'beta_origin':origin,'allowed_paths':[SOURCE],'required_checks':sorted(REQUIRED_CHECKS)}}
                if action=='finish':return {'status':'retry_ready' if healthy else 'rolled_back'}
                return {}
        class Publisher:
            def commit(self,ref):return {'sha':'a'*40}
            def source(self,base):return "export function betaReadyLabel(ready: boolean): string { return 'Checking'; }"
            def candidate(self,*args):events.append('candidate');return 'b'*40
            def verify(self,*args):
                events.append('verify')
                return {'commit':'b'*40,'artifact_digest':'c'*64,'baseline_reproduced':True,'isolated':True,'sensitive_change':False,'changed_paths':[SOURCE],'checks':{name:checks_pass for name in REQUIRED_CHECKS}}
            def promote(self,*args):events.append('promote')
            def health(self,commit,renew):events.append('health');return healthy or commit=='d'*40
            def rollback(self,*args):events.append('rollback');return 'd'*40
        publisher=Publisher();publisher.origin=origin
        with tempfile.TemporaryDirectory() as directory,patch('poll_worker.proposal',return_value={'decision':'patch','patch':'fixture'}),patch('poll_worker.apply_proposal',return_value='fixture'):
            proof=pathlib.Path(directory)/'proof.json';run_once(Client(),publisher,'fixture',proof)
            return events,json.loads(proof.read_text()) if proof.exists() else None
    def test_failed_independent_checks_never_promote_or_notify_retry(self):
        events,proof=self.scenario(checks_pass=False)
        self.assertNotIn('promote',events);self.assertNotIn('finish',events);self.assertIn('review',events);self.assertIsNone(proof)
    def test_success_orders_checks_deployment_health_before_notice(self):
        events,proof=self.scenario()
        self.assertLess(events.index('verify'),events.index('promote'));self.assertLess(events.index('health'),events.index('finish'))
        self.assertEqual(proof['status'],'retry_ready')
    def test_failed_health_restores_previous_release_before_completion(self):
        events,proof=self.scenario(healthy=False)
        self.assertIn('rollback',events);self.assertLess(events.index('rollback'),events.index('finish'))
        self.assertTrue(proof['release']['rollback_healthy']);self.assertEqual(proof['status'],'rolled_back')
