import io, json, os, sqlite3, unittest, pathlib, sys
from unittest.mock import patch
from postgres_store import validate_connection, PostgresStore, Row
from buddy import connect, claim, finish
import test_buddy

class HostingTests(unittest.TestCase):
    def test_operator_diagnostics_never_log_exception_text(self):
        import app
        class AuthenticationError(Exception):sqlstate='28P01'
        with self.assertLogs('beta_buddy',level='WARNING') as captured:
            app.operator_failure(AuthenticationError('password=never-log-this'), 'database')
        text='\n'.join(captured.output)
        self.assertIn('database_authentication',text)
        self.assertNotIn('never-log-this',text)
    def test_coding_proposal_transport_has_no_cloud_keys_and_does_not_apply_patch(self):
        import codex_proposal
        patch_text='diff --git a/src/components/Status.tsx b/src/components/Status.tsx\n--- a/src/components/Status.tsx\n+++ b/src/components/Status.tsx\n@@ -1 +1 @@\n-old\n+new\n'
        def provider(args,**kwargs):
            self.assertEqual(kwargs['env'].get('BUDDY_DATABASE_URL'),None)
            self.assertEqual(kwargs['env'].get('OPENAI_API_KEY'),None)
            self.assertIn('read-only',args)
            self.assertIn('features.shell_tool=false',args)
            self.assertIn('features.apps=false',args)
            self.assertIn('features.plugins=false',args)
            self.assertIn('mcp_servers={}',args)
            pathlib.Path(args[args.index('-o')+1]).write_text(json.dumps({'decision':'patch','patch':patch_text,'reason':'Correct reversed labels'}),encoding='utf-8')
            class Result:returncode=0
            return Result()
        with patch.dict(os.environ,{'BUDDY_DATABASE_URL':'private','OPENAI_API_KEY':'private'}),patch.object(codex_proposal.subprocess,'run',side_effect=provider):
            result=codex_proposal.proposal(sys.executable,'The label remains Loading.',{'src/components/Status.tsx':'old'},['src/components/'])
            self.assertEqual(result['patch'],patch_text)

    def test_sensitive_or_feature_proposal_never_invokes_model(self):
        import codex_proposal
        with patch.object(codex_proposal.subprocess,'run') as provider:
            for report in ['Please add a new report','Change the closing date','Let me access the broker roster']:
                with self.assertRaises(ValueError):codex_proposal.proposal(sys.executable,report,{'src/components/Status.tsx':'old'},['src/components/'])
            provider.assert_not_called()

    def test_exact_isolated_target_and_tls(self):
        project = 'a'*20
        self.assertEqual(validate_connection({'host':f'db.{project}.supabase.co'},project)['sslmode'],'verify-full')
        self.assertTrue(validate_connection({'host':f'db.{project}.supabase.co'},project)['sslrootcert'].endswith('supabase-ca-2021.crt'))
        pooler='aws-1-ca-central-1.pooler.supabase.com'
        self.assertEqual(validate_connection({'host':pooler,'user':f'postgres.{project}'},project,pooler)['sslmode'],'verify-full')
        with self.assertRaises(ValueError):validate_connection({'host':pooler,'user':'postgres.vcdvqhchjxqnuuruobqg'},project,pooler)
        for target, ref in [({'host':'db.vcdvqhchjxqnuuruobqg.supabase.co'},'vcdvqhchjxqnuuruobqg'),({'host':'localhost'},project),({'host':f'db.{project}.supabase.co','options':'unsafe'},project),({'host':f'db.{project}.supabase.co','dbname':'other'},project)]:
            with self.assertRaises(ValueError): validate_connection(target,ref)

    def test_postgres_transaction_lock_and_sql_binding(self):
        class Fake:
            def __init__(self):self.calls=[]
            def execute(self,*args):self.calls.append(args)
        raw=Fake();db=PostgresStore(raw)
        db.execute('BEGIN IMMEDIATE')
        self.assertEqual(raw.calls[0][0],'BEGIN')
        self.assertIn('pg_advisory_xact_lock',raw.calls[1][0])
        db.execute('SELECT id FROM reports WHERE user=?',('tester',))
        self.assertEqual(raw.calls[-1],('SELECT id FROM reports WHERE "user"=%s',('tester',)))
        db.execute("SELECT id FROM reports WHERE description LIKE '%button%'")
        self.assertEqual(raw.calls[-1],("SELECT id FROM reports WHERE description LIKE '%button%'",))
        db.execute("SELECT id FROM reports WHERE description LIKE '%button%' AND user=?",('tester',))
        self.assertEqual(raw.calls[-1],("SELECT id FROM reports WHERE description LIKE '%%button%%' AND \"user\"=%s",('tester',)))
        self.assertEqual(Row(a=1,b=2)[0],1)

    def test_finish_notification_failure_rolls_back_status_and_event(self):
        fixture=test_buddy.BuddyTests();fixture.setUp()
        try:
            report=fixture.report();job=claim(fixture.db)
            fixture.db.execute("CREATE TRIGGER fail_notification BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT, 'fixture'); END")
            with self.assertRaises(sqlite3.IntegrityError):finish(fixture.db,job,'retry_ready','verified_beta_release')
            row=fixture.db.execute('SELECT status,lease FROM reports WHERE id=?',(report['id'],)).fetchone()
            self.assertEqual(row['status'],'repairing');self.assertEqual(row['lease'],job['lease'])
            self.assertEqual(fixture.db.execute("SELECT count(*) FROM events WHERE event='verified_beta_release'").fetchone()[0],0)
        finally:fixture.tearDown()

    def test_wsgi_signed_ingestion_and_production_storage_denied(self):
        import app
        fixture=test_buddy.BuddyTests();fixture.setUp()
        try:
            settings={'BUDDY_STORE':'postgres','BUDDY_CONFIG_JSON':json.dumps(fixture.config)}
            headers=fixture.signed()
            environ={'PATH_INFO':'/v1/reports','REQUEST_METHOD':'GET','CONTENT_LENGTH':'0','wsgi.input':io.BytesIO(b'')}
            environ.update({'HTTP_'+key.upper().replace('-','_'):value for key,value in headers.items()})
            statuses=[]
            class Borrowed:
                def __getattr__(self,key):return getattr(fixture.db,key)
                def close(self):pass
            with patch.dict(os.environ,settings),patch.object(app,'connect',return_value=Borrowed()):
                health=dict(environ,PATH_INFO='/health')
                self.assertEqual(json.loads(b''.join(app.app(health,lambda status,headers:statuses.append(status))))['status'],'ready')
                result=json.loads(b''.join(app.app(environ,lambda status,headers:statuses.append(status))))
                self.assertEqual(statuses[-1],'200 OK');self.assertEqual(result,{'reports':[]})
                app.app(environ,lambda status,headers:statuses.append(status))
                self.assertEqual(statuses[-1],'400 Bad Request') # replay rejected
            with patch.dict(os.environ,{'BUDDY_STORE':'sqlite'}),patch.object(app,'connect') as storage:
                app.app(environ,lambda status,headers:statuses.append(status))
                storage.assert_not_called()
                self.assertEqual(statuses[-1],'503 Service Unavailable')
        finally:fixture.tearDown()

if __name__=='__main__':unittest.main()
