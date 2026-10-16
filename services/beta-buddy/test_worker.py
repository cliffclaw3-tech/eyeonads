import copy,hashlib,hmac,json,os,time,unittest,uuid
from unittest.mock import patch
import test_buddy
from buddy import claim
from worker_api import authenticate_worker,worker_request

class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.fixture=test_buddy.BuddyTests();self.fixture.setUp()
        self.db=self.fixture.db;self.config=self.fixture.config;self.policy=self.fixture.p
        self.config['worker_products']=['eyeonads'];self.policy['worker_mode']='poll'
        self.secret=patch.dict(os.environ,{'BUDDY_WORKER_SECRET':'w'*48});self.secret.start()
    def tearDown(self):self.secret.stop();self.fixture.tearDown()
    def signed(self,secret='w'*48):
        stamp=str(int(time.time()));nonce=uuid.uuid4().hex;body=b'{}';path='/v1/worker/claim'
        canonical='\n'.join(['POST',path,'eyeonads',stamp,nonce,hashlib.sha256(body).hexdigest()])
        return {'X-Buddy-Product':'eyeonads','X-Buddy-Time':stamp,'X-Buddy-Nonce':nonce,'X-Buddy-Signature':hmac.new(secret.encode(),canonical.encode(),hashlib.sha256).hexdigest()}
    def test_product_secret_cannot_claim_and_worker_replay_denied(self):
        with self.assertRaises(ValueError):authenticate_worker(self.db,self.config,'/v1/worker/claim',self.signed('test-secret'),b'{}')
        headers=self.signed();self.assertEqual(authenticate_worker(self.db,self.config,'/v1/worker/claim',headers,b'{}'),'eyeonads')
        with self.assertRaises(ValueError):authenticate_worker(self.db,self.config,'/v1/worker/claim',headers,b'{}')
    def test_serial_product_claim_and_no_caller_policy(self):
        self.fixture.report();self.fixture.report(description='The second blue button stops spinning too soon')
        job=worker_request(self.db,self.config,'/v1/worker/claim','eyeonads',{})['job']
        self.assertIsNotNone(job);self.assertIsNone(claim(self.db,'eyeonads'))
        with self.assertRaises(ValueError):worker_request(self.db,self.config,'/v1/worker/claim','eyeonads',{'repository':'customer-production'})
    def test_finish_requires_exact_verified_release_and_scoped_notice(self):
        self.fixture.report();job=worker_request(self.db,self.config,'/v1/worker/claim','eyeonads',{})['job']
        result=self.fixture.result({'job_id':job['id'],'nonce':job['lease'],'product':'eyeonads','tenant':job['tenant']})
        release={'environment':'beta','origin':self.policy['beta_origin'],'commit':result['commit'],'artifact_digest':result['artifact_digest'],'deployment_id':'fixture','healthy':True}
        value={'id':job['id'],'lease':job['lease'],'verification':result,'release':release}
        for key,replacement in [('origin','https://eyeonads.com'),('commit','c'*40),('environment','production')]:
            bad=copy.deepcopy(value);bad['release'][key]=replacement
            with self.assertRaises(ValueError):worker_request(self.db,self.config,'/v1/worker/finish','eyeonads',bad)
        bad=copy.deepcopy(value);bad['verification']['checks']['tenant_isolation']=False
        with self.assertRaises(ValueError):worker_request(self.db,self.config,'/v1/worker/finish','eyeonads',bad)
        self.assertEqual(worker_request(self.db,self.config,'/v1/worker/finish','eyeonads',value)['status'],'retry_ready')
        self.assertEqual(self.db.execute('SELECT tenant,user FROM notifications').fetchone()['tenant'],'tenant-a')
    def test_rollback_requires_recovered_health(self):
        self.fixture.report();job=worker_request(self.db,self.config,'/v1/worker/claim','eyeonads',{})['job']
        result=self.fixture.result({'job_id':job['id'],'nonce':job['lease'],'product':'eyeonads','tenant':job['tenant']})
        value={'id':job['id'],'lease':job['lease'],'verification':result,'release':{'environment':'beta','origin':self.policy['beta_origin'],'commit':result['commit'],'artifact_digest':result['artifact_digest'],'deployment_id':'fixture','healthy':False,'rolled_back':True,'rollback_healthy':True}}
        self.assertEqual(worker_request(self.db,self.config,'/v1/worker/finish','eyeonads',value)['status'],'rolled_back')
        self.assertNotIn('retry',self.db.execute('SELECT message FROM notifications').fetchone()[0])
    def test_lease_renewal_is_bounded_and_lost_lease_cannot_finish(self):
        self.fixture.report();job=worker_request(self.db,self.config,'/v1/worker/claim','eyeonads',{})['job'];value={'id':job['id'],'lease':job['lease']}
        self.assertTrue(worker_request(self.db,self.config,'/v1/worker/renew','eyeonads',value)['renewed'])
        with patch('worker_api.time.time',return_value=time.time()+1900):
            with self.assertRaises(ValueError):worker_request(self.db,self.config,'/v1/worker/renew','eyeonads',value)
        value['lease']='wrong'
        with self.assertRaises(ValueError):worker_request(self.db,self.config,'/v1/worker/review','eyeonads',value)

