"""Reusable beta-only report service. Standard library; no production credentials.
Run: python buddy.py serve --config config.json --db buddy.sqlite3
     python buddy.py work --config config.json --db buddy.sqlite3
Repair/deploy adapters are trusted operator infrastructure, never report-supplied.
"""
import argparse, hashlib, hmac, json, os, re, secrets, sqlite3, time, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

SENSITIVE = re.compile(r'(auth|permission|access|login|password|secret|credential|billing|payment|privacy|contract|closing date|inspection|waiver|lender|cash deal|legal|migration)',re.I)
SENSITIVE_PATH = re.compile(r'(^|/)(auth|security|migrations|supabase|billing)(/|\.)|(?:^|/)(?:\.env[^/]*|[^/]*(?:access|permission|contract|payment|credential|secret)[^/]*)$',re.I)
STATUSES = {'queued','feature_review','operational_review','blocked','repairing','review_required','retry_ready','rolled_back'}
REQUIRED_CHECKS={'reported_behavior','existing_behavior','regression','typecheck','build','tenant_isolation','production_denied','diff_security_review'}
FEATURE_REQUEST=re.compile(r'^(?:please\s+(?:add|create|integrate|include)|can you\s+(?:add|create|integrate)|i (?:want|would like)|we need a new|add\s|integrate\s)|\bnew feature\b',re.I)

def redact(text):
    text = str(text)[:2000]
    for pattern in [r'Bearer\s+\S+',r'\b(?:sk[-_]|sb_secret_)[A-Za-z0-9_-]+',r'\beyJ[\w-]+\.[\w-]+\.[\w-]+',r'(?:password|token|api[_ -]?key|secret)\s*[:=]\s*\S+',r'https?://\S+',r'\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b',r'\b\d{3}[-. ]?\d{3}[-. ]?\d{4}\b']:
        text = re.sub(pattern,'[removed]',text,flags=re.I)
    return text

def connect(path):
    if os.environ.get('BUDDY_STORE') == 'postgres':
        from postgres_store import connect_postgres
        return connect_postgres()
    db=sqlite3.connect(path,timeout=10,isolation_level=None);db.row_factory=sqlite3.Row
    db.executescript('''PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY,product TEXT NOT NULL,tenant TEXT NOT NULL,user TEXT NOT NULL,kind TEXT NOT NULL,description TEXT NOT NULL,page TEXT NOT NULL,diagnostics TEXT NOT NULL,fingerprint TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,lease TEXT,leased_at INTEGER,created INTEGER NOT NULL,updated INTEGER NOT NULL,release TEXT);
    CREATE INDEX IF NOT EXISTS report_queue ON reports(status,updated);
    CREATE INDEX IF NOT EXISTS report_dedup ON reports(product,tenant,user,fingerprint,created);
    CREATE TABLE IF NOT EXISTS nonces(product TEXT,nonce TEXT,created INTEGER,PRIMARY KEY(product,nonce));
    CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,report TEXT NOT NULL,event TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,report TEXT NOT NULL,product TEXT NOT NULL,tenant TEXT NOT NULL,user TEXT NOT NULL,message TEXT NOT NULL,created INTEGER NOT NULL,UNIQUE(report,message));''')
    return db

def event(db,report,value):
    db.execute('INSERT INTO events(report,event,created) VALUES(?,?,?)',(report,value,int(time.time())))

def validate_config(config):
    if config.get('environment')!='beta':raise ValueError('Beta environment required')
    for name,p in config.get('products',{}).items():
        if not re.fullmatch(r'[a-z0-9-]{1,40}',name):raise ValueError('Invalid product')
        beta=urlsplit(p.get('beta_origin',''));prod=urlsplit(p.get('production_origin',''))
        if beta.scheme!='https' or not beta.hostname or beta.username or beta.password or beta.query or beta.fragment or beta.path not in ('','/') or beta.hostname==prod.hostname or beta.hostname in ('eyeonads.com','www.eyeonads.com','trueclose.homes','www.trueclose.homes'):raise ValueError('Isolated beta origin required')
        if p.get('isolated_data') is not True:raise ValueError('Separate beta data required')
        if not isinstance(p.get('required_checks'),list) or not REQUIRED_CHECKS.issubset(set(p['required_checks'])) or not p.get('allowed_paths'):raise ValueError('All mandatory trusted checks and path allowlist required')
        if not os.environ.get(p.get('secret_env','')):raise ValueError('Product signing secret unavailable')
    return config

def authenticate(db,config,method,path,headers,body):
    product=headers.get('X-Buddy-Product','');tenant=headers.get('X-Buddy-Tenant','');user=headers.get('X-Buddy-User','');stamp=headers.get('X-Buddy-Time','');nonce=headers.get('X-Buddy-Nonce','')
    p=config['products'].get(product)
    if not p or not all(re.fullmatch(r'[A-Za-z0-9_-]{1,100}',s) for s in (tenant,user,nonce)):raise ValueError('Unauthorized')
    if not stamp.isdigit() or abs(int(time.time())-int(stamp))>60:raise ValueError('Expired request')
    canonical='\n'.join([method,path,product,tenant,user,stamp,nonce,hashlib.sha256(body).hexdigest()])
    expected=hmac.new(os.environ[p['secret_env']].encode(),canonical.encode(),hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected,headers.get('X-Buddy-Signature','')):raise ValueError('Unauthorized')
    try:db.execute('INSERT INTO nonces VALUES(?,?,?)',(product,nonce,int(time.time())))
    except sqlite3.IntegrityError:raise ValueError('Replay rejected')
    return product,tenant,user

def submit(db,config,identity,value):
    product,tenant,user=identity;now=int(time.time());p=config['products'][product]
    if not isinstance(value,dict) or value.get('consent') is not True or value.get('kind') not in ('bug','feature','correction'):raise ValueError('Invalid report')
    actor_role=value.get('actor_role','ordinary')
    if value.get('kind')=='correction' and 'support.correction.request' not in p.get('role_capabilities',{}).get(actor_role,[]):raise ValueError('Operational correction requires an authorized product role')
    description=redact(value.get('description','')).strip()
    if not 10<=len(description)<=2000:raise ValueError('Invalid description')
    page=value.get('page','/other');page=page if page in p.get('pages',[]) else '/other'
    diagnostics=[]
    for d in value.get('diagnostics',[])[:10]:
        if isinstance(d,dict):diagnostics.append({'code':d.get('code') if d.get('code') in ('network','http_error','client_error') else 'client_error','status':d.get('status') if type(d.get('status')) is int and 400<=d['status']<=599 else None})
    context=value.get('context',{})
    if not isinstance(context,dict):context={}
    safe_context={key:context.get(key) is True for key in ('broker_access','pilot_access','has_setup')}
    count=context.get('roster_count',0);safe_context['roster_count']=count if type(count) is int and 0<=count<=1000 else 0
    access_issue=page.startswith('/broker') and (context.get('broker_access') is False or context.get('pilot_access') is False)
    diagnostics={'events':diagnostics,'setup':safe_context}
    kind=value['kind']
    if kind=='bug' and not access_issue and not SENSITIVE.search(description) and FEATURE_REQUEST.search(description):kind='feature'
    fingerprint=hashlib.sha256(json.dumps([kind,description.lower(),page,diagnostics],sort_keys=True).encode()).hexdigest()
    db.execute('BEGIN IMMEDIATE')
    try:
        prior=db.execute('SELECT id,status FROM reports WHERE product=? AND tenant=? AND user=? AND fingerprint=? AND created>? ORDER BY created DESC LIMIT 1',(product,tenant,user,fingerprint,now-86400)).fetchone()
        if prior:db.execute('COMMIT');return dict(prior)|{'duplicate':True}
        count=db.execute('SELECT count(*) FROM reports WHERE product=? AND tenant=? AND user=? AND created>?',(product,tenant,user,now-3600)).fetchone()[0]
        if count>=10:raise OverflowError('Report limit reached')
        ready=(p.get('runner_url') and p.get('deployer_url')) or (p.get('worker_mode')=='poll' and os.environ.get('BUDDY_WORKER_SECRET'))
        status='feature_review' if kind=='feature' else 'operational_review' if kind=='correction' else 'review_required' if access_issue or SENSITIVE.search(description) else 'queued' if ready else 'blocked'
        rid=str(uuid.uuid4());db.execute('INSERT INTO reports(id,product,tenant,user,kind,description,page,diagnostics,fingerprint,status,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(rid,product,tenant,user,kind,description,page,json.dumps(diagnostics),fingerprint,status,now,now));event(db,rid,'submitted:'+status+':actor_role:'+str(actor_role)[:40])
        db.execute('COMMIT');return {'id':rid,'status':status,'duplicate':False}
    except Exception:db.execute('ROLLBACK');raise

def claim(db,product=None):
    now=int(time.time());db.execute('BEGIN IMMEDIATE')
    try:
        expired=db.execute("SELECT id FROM reports WHERE status='repairing' AND leased_at<?",(now-600,)).fetchall()
        # Unknown deployment outcomes must be reconciled by an operator, never blindly retried.
        for r in expired:db.execute("UPDATE reports SET status='review_required',lease=NULL,updated=? WHERE id=?",(now,r['id']));event(db,r['id'],'lease_expired:reconcile_external_outcome')
        # One active repair per product: independent jobs must not race a beta
        # promotion/rollback against each other. Other products remain runnable.
        statement="SELECT * FROM reports r WHERE status='queued' AND attempts<2 AND NOT EXISTS (SELECT 1 FROM reports active WHERE active.product=r.product AND active.status='repairing')"
        parameters=()
        if product is not None:statement+=' AND r.product=?';parameters=(product,)
        r=db.execute(statement+' ORDER BY created LIMIT 1',parameters).fetchone()
        if not r:db.execute('COMMIT');return None
        token=secrets.token_hex(24);db.execute("UPDATE reports SET status='repairing',attempts=attempts+1,lease=?,leased_at=?,updated=? WHERE id=?",(token,now,now,r['id']));event(db,r['id'],'claimed');db.execute('COMMIT')
        return dict(r)|{'lease':token,'attempts':r['attempts']+1}
    except Exception:db.execute('ROLLBACK');raise

def finish(db,r,status,reason,release=None):
    db.execute('BEGIN IMMEDIATE')
    try:
        _finish(db,r,status,reason,release)
        db.execute('COMMIT')
    except Exception:
        db.execute('ROLLBACK')
        raise

def _finish(db,r,status,reason,release=None):
    if status not in STATUSES:raise ValueError('Invalid status')
    result=db.execute("UPDATE reports SET status=?,lease=NULL,updated=?,release=? WHERE id=? AND status='repairing' AND lease=?",(status,int(time.time()),json.dumps(release) if release else None,r['id'],r['lease']))
    if result.rowcount!=1:raise ValueError('Lease lost')
    event(db,r['id'],reason)
    message={'retry_ready':'A verified beta fix is available. Please retry the action you reported.','rolled_back':'A beta fix was rolled back after its health check failed. Your report is under review.','review_required':'Your report needs operator review before a safe repair can proceed.','blocked':'Your report is saved; repair infrastructure needs operator attention.'}.get(status)
    if message:db.execute('INSERT OR IGNORE INTO notifications VALUES(?,?,?,?,?,?,?)',(str(uuid.uuid4()),r['id'],r['product'],r['tenant'],r['user'],message,int(time.time())))

def safe_paths(paths,p):
    return bool(paths) and len(paths)<=20 and all(isinstance(x,str) and not x.startswith('/') and '\\' not in x and not any(s in ('..','') for s in x.split('/')) and not SENSITIVE_PATH.search(x) and any(x.startswith(prefix) for prefix in p['allowed_paths']) for x in paths)

def qualifies(result,p):
    return (isinstance(result,dict) and result.get('baseline_reproduced') is True and result.get('sensitive_change') is False and result.get('isolated') is True and safe_paths(result.get('changed_paths',[]),p)
        and re.fullmatch(r'[a-f0-9]{40}',str(result.get('commit',''))) is not None
        and re.fullmatch(r'[a-f0-9]{64}',str(result.get('artifact_digest',''))) is not None
        and all(result.get('checks',{}).get(check) is True for check in p['required_checks']))

def trusted_call(url,secret,payload):
    parsed=urlsplit(url)
    if parsed.scheme!='https' or parsed.username or parsed.password or not parsed.hostname:raise ValueError('Trusted HTTPS adapter required')
    body=json.dumps(payload,separators=(',',':')).encode();sig=hmac.new(secret.encode(),body,hashlib.sha256).hexdigest()
    # Never follow redirects with credentials to a different host.
    import urllib.request
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs):return None
    opener=urllib.request.build_opener(NoRedirect())
    with opener.open(Request(url,body,{'Content-Type':'application/json','X-Buddy-Signature':sig}),timeout=120) as response:
        raw=response.read(100001)
        if len(raw)>100000:raise ValueError('Oversized adapter reply')
        expected=hmac.new(secret.encode(),raw,hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected,response.headers.get('X-Buddy-Signature','')):raise ValueError('Untrusted adapter reply')
        value=json.loads(raw)
        if value.get('job_id')!=payload['job_id'] or value.get('nonce')!=payload['nonce'] or value.get('product')!=payload['product'] or value.get('tenant')!=payload['tenant']:raise ValueError('Adapter scope mismatch')
        return value

def work_once(db,config,call=trusted_call):
    r=claim(db)
    if not r:return False
    p=config['products'][r['product']];secret=os.environ.get(p.get('runner_secret_env',''))
    if not secret or not p.get('runner_url') or not p.get('deployer_url'):finish(db,r,'blocked','missing_adapter_credentials');return True
    payload={'job_id':r['id'],'nonce':r['lease'],'product':r['product'],'tenant':r['tenant'],'environment':'beta','base_ref':p['base_ref'],'repository':p['repository'],'required_checks':p['required_checks'],'allowed_paths':p['allowed_paths'],
      'report':{'untrusted_description':r['description'],'page':r['page'],'diagnostics':json.loads(r['diagnostics'])}}
    try:
        result=call(p['runner_url'],secret,payload|{'action':'repair'})
        if not qualifies(result,p):finish(db,r,'review_required','repair_checks_or_path_policy_failed');return True
        release=call(p['deployer_url'],secret,payload|{'action':'deploy','commit':result['commit'],'artifact_digest':result['artifact_digest'],'target':p['beta_origin']})
        if release.get('environment')!='beta' or release.get('origin')!=p['beta_origin'] or release.get('commit')!=result['commit'] or release.get('artifact_digest')!=result['artifact_digest'] or not isinstance(release.get('deployment_id'),str) or not 1<=len(release['deployment_id'])<=200:finish(db,r,'review_required','deployment_scope_mismatch');return True
        if release.get('healthy') is not True:
            rolled=call(p['deployer_url'],secret,payload|{'action':'rollback','target':p['beta_origin'],'deployment_id':release.get('deployment_id')})
            finish(db,r,'rolled_back' if rolled.get('rolled_back') is True and rolled.get('origin')==p['beta_origin'] else 'review_required','failed_health_check',release);return True
        finish(db,r,'retry_ready','verified_beta_release',release)
    except Exception:
        # No raw exceptions/credentials in audit or tester messages. Never re-deploy an uncertain outcome.
        finish(db,r,'review_required','adapter_failed:operator_reconciliation_required')
    return True

def handler(config,db_path):
    class API(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def reply(self,code,value):
            data=json.dumps(value).encode();self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
        def do_GET(self):self.handle_api('GET')
        def do_POST(self):self.handle_api('POST')
        def handle_api(self,method):
            if self.path not in ('/v1/reports','/v1/notifications'):return self.reply(404,{'error':'Not found'})
            if method=='POST' and self.path!='/v1/reports':return self.reply(405,{'error':'Method not allowed'})
            try:
                size=int(self.headers.get('Content-Length','0'))
                if size<0 or size>12000:return self.reply(413,{'error':'Too large'})
                body=self.rfile.read(size);db=connect(db_path)
                try:
                    who=authenticate(db,config,method,self.path,self.headers,body)
                    if method=='POST':value=submit(db,config,who,json.loads(body));code=201
                    elif self.path=='/v1/notifications':value={'notifications':[dict(r) for r in db.execute('SELECT id,message FROM notifications WHERE product=? AND tenant=? AND user=? ORDER BY created DESC LIMIT 20',who)]};code=200
                    else:value={'reports':[dict(r) for r in db.execute('SELECT id,kind,status,created FROM reports WHERE product=? AND tenant=? AND user=? ORDER BY created DESC LIMIT 20',who)]};code=200
                    self.reply(code,value)
                finally:db.close()
            except OverflowError:self.reply(429,{'error':'Report limit reached'})
            except (ValueError,KeyError,TypeError):self.reply(400,{'error':'Invalid or unauthorized request'})
            except Exception:self.reply(503,{'error':'Support unavailable; retry later'})
    return API

def main():
    p=argparse.ArgumentParser();p.add_argument('mode',choices=['serve','work','purge']);p.add_argument('--config',required=True);p.add_argument('--db',default='buddy.sqlite3');p.add_argument('--port',type=int,default=8790);args=p.parse_args()
    config=validate_config(json.load(open(args.config,encoding='utf-8')))
    db=connect(args.db)
    if args.mode=='work':work_once(db,config)
    elif args.mode=='purge':
        # Fixed 30-day report retention. This operator CLI is not exposed to testers.
        cutoff=int(time.time())-30*86400
        db.execute('BEGIN IMMEDIATE');db.execute('DELETE FROM notifications WHERE created<?',(cutoff,));db.execute('DELETE FROM events WHERE created<?',(cutoff,));db.execute('DELETE FROM reports WHERE created<?',(cutoff,));db.execute('DELETE FROM nonces WHERE created<?',(int(time.time())-120,));db.execute('COMMIT')
    else:db.close();ThreadingHTTPServer(('127.0.0.1',args.port),handler(config,args.db)).serve_forever()

if __name__=='__main__':main()
