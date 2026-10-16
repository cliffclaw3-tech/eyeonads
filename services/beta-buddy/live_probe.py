"""Operator-only synthetic ingress probe. Never runs a repair or deployment."""
import argparse, hashlib, hmac, json, pathlib, time, uuid
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError
from urllib.parse import urlsplit

def probe(origin, secret):
    parsed=urlsplit(origin)
    if parsed.scheme!='https' or parsed.hostname!='beta-buddy-service.vercel.app' or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('','/'):
        raise ValueError('Verified isolated service origin required')
    class NoRedirect(HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs):return None
    opener=build_opener(NoRedirect())
    identity='buddy-fixture-'+uuid.uuid4().hex
    def signed(method,path,body,tenant=identity):
        stamp=str(int(time.time()));nonce=uuid.uuid4().hex
        canonical='\n'.join([method,path,'eyeonads',tenant,identity,stamp,nonce,hashlib.sha256(body).hexdigest()])
        return {'Content-Type':'application/json','X-Buddy-Product':'eyeonads','X-Buddy-Tenant':tenant,'X-Buddy-User':identity,'X-Buddy-Time':stamp,'X-Buddy-Nonce':nonce,'X-Buddy-Signature':hmac.new(secret.encode(),canonical.encode(),hashlib.sha256).hexdigest()}
    def request(method,path,body=b'',tenant=identity,headers=None):
        headers=headers or signed(method,path,body,tenant)
        try:
            with opener.open(Request(origin.rstrip('/')+path,body if method=='POST' else None,headers,method=method),timeout=20) as response:
                raw=response.read(20001)
                if len(raw)>20000:raise ValueError('Oversized reply')
                return response.status,json.loads(raw)
        except HTTPError as error:return error.code,{}
    with opener.open(origin.rstrip('/')+'/health',timeout=20) as response:
        if response.status!=200 or json.load(response).get('environment')!='beta':raise ValueError('Service not healthy in beta')
    body=json.dumps({'kind':'feature','description':'Synthetic operator fixture: please add a sample beta chart. Not a customer request.','consent':True,'page':'/other'}).encode()
    status,created=request('POST','/v1/reports',body)
    if status!=201 or created.get('status')!='feature_review':raise RuntimeError('Synthetic feature ingestion did not pass')
    status,duplicate=request('POST','/v1/reports',body)
    if status!=201 or duplicate.get('id')!=created['id'] or duplicate.get('duplicate') is not True:raise RuntimeError('Deduplication did not pass')
    status,own=request('GET','/v1/reports')
    if status!=200 or len(own.get('reports',[]))!=1:raise RuntimeError('Scoped read did not pass')
    status,other=request('GET','/v1/reports',tenant=identity+'-other')
    if status!=200 or other.get('reports')!=[]:raise RuntimeError('Tenant isolation did not pass')
    replay_headers=signed('GET','/v1/reports',b'')
    if request('GET','/v1/reports',headers=replay_headers)[0]!=200 or request('GET','/v1/reports',headers=replay_headers)[0]!=400:raise RuntimeError('Replay protection did not pass')
    tampered=signed('GET','/v1/reports',b'');tampered['X-Buddy-Tenant']=identity+'-other'
    if request('GET','/v1/reports',headers=tampered)[0]!=400:raise RuntimeError('Signature scope did not pass')
    return {'service':origin,'environment':'beta','report_id':created['id'],'fixture_identity':identity,'ingestion':True,'deduplication':True,'tenant_isolation':True,'replay_rejection':True,'signature_scope':True,'feature_not_repaired':True,'production_changes':False}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--operator-env',required=True);parser.add_argument('--output',required=True);args=parser.parse_args()
    # Read only the locally generated product signing value; do not print it.
    line=next(line for line in pathlib.Path(args.operator_env).read_text().splitlines() if line.startswith('BUDDY_EYEONADS_SECRET='))
    secret=line.split('=',1)[1].strip().strip("'")
    result=probe('https://beta-buddy-service.vercel.app',secret)
    pathlib.Path(args.output).write_text(json.dumps(result,indent=2)+'\n')
    print('PASS: live signed ingestion, deduplication, tenant reads, replay and signature guards. Synthetic feature only; no repair/deployment run.')
