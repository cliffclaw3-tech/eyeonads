import copy,hashlib,hmac,json,os,tempfile,time,unittest,uuid
from buddy import connect,submit,work_once,authenticate,validate_config,qualifies,claim,REQUIRED_CHECKS
from capabilities import can_act,override_audit

class BuddyTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.db=connect(self.tmp.name+'/test.db')
        os.environ['PRODUCT_TEST_SECRET']='test-secret';os.environ['RUNNER_TEST_SECRET']='runner-secret'
        self.p={'secret_env':'PRODUCT_TEST_SECRET','runner_secret_env':'RUNNER_TEST_SECRET','production_origin':'https://eyeonads.com','beta_origin':'https://beta.example.invalid','isolated_data':True,'pages':['/broker'],'allowed_paths':['src/components/','tests/'],'required_checks':sorted(REQUIRED_CHECKS),'runner_url':'https://runner.example.invalid','deployer_url':'https://deploy.example.invalid','base_ref':'beta','repository':'fixture'}
        self.config={'environment':'beta','products':{'eyeonads':self.p}};validate_config(self.config)
    def tearDown(self):self.db.close();self.tmp.cleanup()
    def report(self,**kw):return submit(self.db,self.config,('eyeonads','tenant-a','user-a'),{'kind':'bug','description':'The blue button does nothing when clicked','consent':True,'page':'/broker',**kw})
    def signed(self,nonce=None,tenant='tenant-a'):
        body=b'';stamp=str(int(time.time()));nonce=nonce or str(uuid.uuid4());canonical='\n'.join(['GET','/v1/reports','eyeonads',tenant,'user-a',stamp,nonce,hashlib.sha256(body).hexdigest()]);return {'X-Buddy-Product':'eyeonads','X-Buddy-Tenant':tenant,'X-Buddy-User':'user-a','X-Buddy-Time':stamp,'X-Buddy-Nonce':nonce,'X-Buddy-Signature':hmac.new(b'test-secret',canonical.encode(),hashlib.sha256).hexdigest()}
    def result(self,payload):return {**{k:payload[k] for k in ('job_id','nonce','product','tenant')},'baseline_reproduced':True,'sensitive_change':False,'isolated':True,'changed_paths':['src/components/Button.tsx'],'commit':'a'*40,'artifact_digest':'b'*64,'checks':{x:True for x in self.p['required_checks']}}
    def test_signatures_scope_and_replay(self):
        h=self.signed();self.assertEqual(authenticate(self.db,self.config,'GET','/v1/reports',h,b'')[1],'tenant-a')
        with self.assertRaises(ValueError):authenticate(self.db,self.config,'GET','/v1/reports',h,b'')
        h=self.signed();h['X-Buddy-Tenant']='tenant-b'
        with self.assertRaises(ValueError):authenticate(self.db,self.config,'GET','/v1/reports',h,b'')
    def test_dedup_and_tenant_separation(self):
        a=self.report();b=self.report();self.assertEqual(a['id'],b['id']);self.assertTrue(b['duplicate'])
        c=submit(self.db,self.config,('eyeonads','tenant-b','user-a'),{'kind':'bug','description':'The blue button does nothing when clicked','consent':True});self.assertNotEqual(a['id'],c['id'])
    def test_features_and_access_escalate(self):
        self.assertEqual(self.report(kind='feature')['status'],'feature_review')
        self.assertEqual(self.report(description='Broker access is denied during setup')['status'],'review_required')
        self.assertFalse(work_once(self.db,self.config))
    def test_bethany_style_missing_pilot_is_access_review_not_repair(self):
        self.assertEqual(self.report(description='It will not let me set up the brokerage',context={'broker_access':True,'pilot_access':False,'has_setup':False,'roster_count':0})['status'],'review_required')
    def test_missing_infrastructure_is_blocked(self):
        self.p['runner_url']='';self.assertEqual(self.report()['status'],'blocked')
    def test_feature_disguised_as_bug_is_not_repaired(self):
        self.assertEqual(self.report(description='Please add another reporting option')['status'],'feature_review');self.assertFalse(work_once(self.db,self.config))
    def test_consent_redaction_allowlist(self):
        with self.assertRaises(ValueError):self.report(consent=False)
        a=self.report(description='Button stopped. token=abc123 user@example.com https://example.com?secret=yes',context={'broker_access':True,'roster_count':90000,'raw_contract':'private'})
        row=dict(self.db.execute('SELECT * FROM reports WHERE id=?',(a['id'],)).fetchone());self.assertNotIn('abc123',row['description']);self.assertNotIn('raw_contract',row['diagnostics']);self.assertIn('"roster_count": 0',row['diagnostics'])
    def test_verified_fix_notifies_only_correct_tester(self):
        a=self.report();calls=[]
        def adapter(url,secret,p):
            calls.append(p['action'])
            if p['action']=='repair':return self.result(p)
            return {'environment':'beta','origin':self.p['beta_origin'],'commit':p['commit'],'artifact_digest':p['artifact_digest'],'healthy':True,'deployment_id':'fixture'}
        self.assertTrue(work_once(self.db,self.config,adapter));self.assertEqual(calls,['repair','deploy'])
        self.assertEqual(self.db.execute('SELECT status FROM reports').fetchone()[0],'retry_ready')
        n=self.db.execute('SELECT tenant,user FROM notifications').fetchone();self.assertEqual((n['tenant'],n['user']),('tenant-a','user-a'))
        self.assertFalse(work_once(self.db,self.config,adapter))
    def test_failed_checks_never_deploy(self):
        self.report();calls=[]
        def adapter(url,s,p):calls.append(p['action']);r=self.result(p);r['checks']['regression']=False;return r
        work_once(self.db,self.config,adapter);self.assertEqual(calls,['repair']);self.assertEqual(self.db.execute('SELECT status FROM reports').fetchone()[0],'review_required')
    def test_sensitive_diff_cannot_qualify(self):
        for path in ['src/components/Access.tsx','../escape','src/components/.env','src/components//Button.tsx','supabase/migrations/a.sql']:
            r=self.result({'job_id':'x','nonce':'x','product':'eyeonads','tenant':'a'});r['changed_paths']=[path];self.assertFalse(qualifies(r,self.p))
        r=self.result({'job_id':'x','nonce':'x','product':'eyeonads','tenant':'a'});r['baseline_reproduced']=False;self.assertFalse(qualifies(r,self.p))
    def test_artifact_or_production_target_mismatch_never_notifies_ready(self):
        self.report();calls=[]
        def adapter(url,s,p):
            calls.append(p['action'])
            if p['action']=='repair':return self.result(p)
            return {'environment':'production','origin':'https://eyeonads.com','commit':p['commit'],'artifact_digest':'c'*64,'healthy':True,'deployment_id':'fixture'}
        work_once(self.db,self.config,adapter);self.assertEqual(self.db.execute('SELECT status FROM reports').fetchone()[0],'review_required');self.assertEqual(self.db.execute("SELECT count(*) FROM notifications WHERE message LIKE '%verified beta fix%'").fetchone()[0],0)
    def test_report_rate_and_attempt_bounds(self):
        for i in range(10):self.report(description='A distinct display problem number '+str(i))
        with self.assertRaises(OverflowError):self.report(description='The eleventh distinct display problem')
        self.db.execute('UPDATE reports SET attempts=2');self.assertIsNone(claim(self.db))
    def test_failed_health_rolls_back(self):
        self.report();calls=[]
        def adapter(url,s,p):
            calls.append(p['action'])
            if p['action']=='repair':return self.result(p)
            if p['action']=='rollback':return {'origin':self.p['beta_origin'],'rolled_back':True}
            return {'environment':'beta','origin':self.p['beta_origin'],'commit':p['commit'],'artifact_digest':p['artifact_digest'],'healthy':False,'deployment_id':'fixture'}
        work_once(self.db,self.config,adapter);self.assertEqual(calls,['repair','deploy','rollback']);self.assertEqual(self.db.execute('SELECT status FROM reports').fetchone()[0],'rolled_back')
    def test_crash_does_not_repeat_uncertain_deployment(self):
        self.report();r=claim(self.db);self.db.execute('UPDATE reports SET leased_at=?',(int(time.time())-601,));self.assertIsNone(claim(self.db));self.assertEqual(self.db.execute('SELECT status FROM reports').fetchone()[0],'review_required')
    def test_production_configuration_denied(self):
        for change in [{'beta_origin':'https://eyeonads.com'},{'isolated_data':False},{'required_checks':[]}]:
            c=copy.deepcopy(self.config);c['products']['eyeonads'].update(change)
            with self.assertRaises(ValueError):validate_config(c)

    def test_owner_admin_and_ordinary_scopes(self):
        policy={'owner':['bank_accounts.manage','transaction.confirm','transaction.dismiss'],'admin':['transaction.confirm','transaction.dismiss'],'agent':['scan.own']}
        self.assertTrue(can_act(policy,'owner','org-a','org-a','bank_accounts.manage'))
        self.assertFalse(can_act(policy,'admin','org-a','org-a','bank_accounts.manage'))
        self.assertTrue(can_act(policy,'admin','org-a','org-a','transaction.dismiss'))
        self.assertFalse(can_act(policy,'agent','org-a','org-a','transaction.dismiss'))
        self.assertFalse(can_act(policy,'owner','org-a','org-b','transaction.dismiss'))
        self.assertFalse(can_act(policy,'owner','org-a','org-a','bank_accounts.manage','buddy'))
        audit=override_audit('admin-a','admin','org-a','org-a','transaction-1','transaction.dismiss','Inspection explicitly waived; verified by broker',policy,'a'*64,'b'*64)
        self.assertEqual(audit['actor_id'],'admin-a');self.assertIn('waived',audit['reason'])
        with self.assertRaises(PermissionError):override_audit('agent-a','agent','org-a','org-a','transaction-1','transaction.dismiss','Reason',policy,'a'*64,'b'*64)

    def test_operational_correction_is_not_a_software_repair(self):
        self.p['role_capabilities']={'broker':['support.correction.request'],'agent':[]}
        with self.assertRaises(ValueError):self.report(kind='correction',actor_role='agent')
        self.assertEqual(self.report(kind='correction',actor_role='broker')['status'],'operational_review')
        self.assertFalse(work_once(self.db,self.config))

    def test_real_http_report_and_tenant_scoped_polling(self):
        from buddy import handler
        from http.server import ThreadingHTTPServer
        from urllib.request import Request,urlopen
        import threading
        path=self.tmp.name+'/http.db';server=ThreadingHTTPServer(('127.0.0.1',0),handler(self.config,path));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        def request(method,route,body,tenant='tenant-a'):
            data=json.dumps(body).encode() if body else b'';stamp=str(int(time.time()));nonce=str(uuid.uuid4());canonical='\n'.join([method,route,'eyeonads',tenant,'user-a',stamp,nonce,hashlib.sha256(data).hexdigest()])
            headers={'X-Buddy-Product':'eyeonads','X-Buddy-Tenant':tenant,'X-Buddy-User':'user-a','X-Buddy-Time':stamp,'X-Buddy-Nonce':nonce,'X-Buddy-Signature':hmac.new(b'test-secret',canonical.encode(),hashlib.sha256).hexdigest()}
            with urlopen(Request('http://127.0.0.1:'+str(server.server_port)+route,data if method=='POST' else None,headers,method=method),timeout=5) as response:return json.load(response)
        try:
            created=request('POST','/v1/reports',{'kind':'feature','description':'Please add another useful option','consent':True})
            self.assertEqual(created['status'],'feature_review')
            self.assertEqual(len(request('GET','/v1/reports',None)['reports']),1)
            self.assertEqual(request('GET','/v1/reports',None,'tenant-b')['reports'],[])
        finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':unittest.main()
