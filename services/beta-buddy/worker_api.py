"""Scoped operator polling API. Product backends cannot claim repair work.

The operator identity is a separate secret; no database password leaves ingress.
Worker responses never accept a caller-selected beta target or path policy.
"""
import hashlib,hmac,json,os,re,sqlite3,time
from buddy import claim,finish,qualifies

def authenticate_worker(db,config,path,headers,body):
    secret=os.environ.get('BUDDY_WORKER_SECRET','')
    product=headers.get('X-Buddy-Product','')
    stamp=headers.get('X-Buddy-Time','');nonce=headers.get('X-Buddy-Nonce','')
    if len(secret)<32 or product not in config.get('worker_products',[]) or product not in config['products']:
        raise ValueError('Worker unavailable')
    if not stamp.isdigit() or abs(int(time.time())-int(stamp))>60 or not re.fullmatch(r'[A-Za-z0-9_-]{16,100}',nonce):
        raise ValueError('Expired worker request')
    canonical='\n'.join(['POST',path,product,stamp,nonce,hashlib.sha256(body).hexdigest()])
    expected=hmac.new(secret.encode(),canonical.encode(),hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected,headers.get('X-Buddy-Signature','')):raise ValueError('Unauthorized worker')
    try:db.execute('INSERT INTO nonces VALUES(?,?,?)',('worker-'+product,nonce,int(time.time())))
    except sqlite3.IntegrityError:raise ValueError('Replay rejected') from None
    return product

def worker_request(db,config,path,product,value):
    policy=config['products'][product]
    if policy.get('worker_mode')!='poll':raise ValueError('Polling disabled')
    if path=='/v1/worker/claim':
        if value!={}:raise ValueError('No caller policy overrides')
        report=claim(db,product)
        if not report:return {'job':None}
        return {'job':{k:report[k] for k in ('id','product','tenant','lease','description','page')},
                'policy':{k:policy[k] for k in ('repository','base_ref','allowed_paths','required_checks','beta_origin')}}
    job_id=value.get('id');lease=value.get('lease')
    row=db.execute("SELECT * FROM reports WHERE id=? AND product=? AND status='repairing' AND lease=?",(job_id,product,lease)).fetchone()
    if not row:raise ValueError('Lease lost')
    report=dict(row)
    if path=='/v1/worker/renew':
        started=db.execute("SELECT MAX(created) FROM events WHERE report=? AND event='claimed'",(job_id,)).fetchone()[0]
        if not started or int(time.time())-started>1800:raise ValueError('Worker deadline exceeded')
        result=db.execute("UPDATE reports SET leased_at=? WHERE id=? AND product=? AND status='repairing' AND lease=?",(int(time.time()),job_id,product,lease))
        if result.rowcount!=1:raise ValueError('Lease lost')
        return {'renewed':True}
    if path=='/v1/worker/review':
        finish(db,report,'review_required','worker_requested_review')
        return {'status':'review_required'}
    if path!='/v1/worker/finish':raise ValueError('Unknown worker route')
    result=value.get('verification',{});release=value.get('release',{})
    if not qualifies(result,policy):raise ValueError('Independent verification required')
    if (release.get('environment')!='beta' or release.get('origin')!=policy['beta_origin']
        or release.get('commit')!=result['commit'] or release.get('artifact_digest')!=result['artifact_digest']
        or not isinstance(release.get('deployment_id'),str) or not 1<=len(release['deployment_id'])<=200):
        raise ValueError('Deployment scope mismatch')
    if release.get('healthy') is True:status='retry_ready'
    elif release.get('rolled_back') is True and release.get('rollback_healthy') is True:status='rolled_back'
    else:status='review_required'
    finish(db,report,status,'verified_beta_release' if status=='retry_ready' else 'failed_health_check',release)
    return {'status':status}
