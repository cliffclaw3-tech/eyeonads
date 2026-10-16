"""Local operator worker using existing Codex sign-in and scoped beta publishing.

No database credential or customer production authority. Failures stop for
operator review; an uncertain promotion is never blindly repeated.
"""
import argparse,hashlib,hmac,json,os,pathlib,re,subprocess,tempfile,time,urllib.request,uuid
from beta_publisher import BetaPublisher,REPOSITORY,RELEASE,SOURCE,NoRedirect
from buddy import qualifies,REQUIRED_CHECKS
from codex_proposal import proposal

class WorkerClient:
    def __init__(self,secret):
        if len(secret)<32:raise ValueError('Separate worker credential required')
        self.secret=secret;self.opener=urllib.request.build_opener(NoRedirect())
    def request(self,action,value):
        if action not in ('claim','finish','review','renew'):raise ValueError('Unknown worker action')
        path='/v1/worker/'+action;body=json.dumps(value,separators=(',',':')).encode();stamp=str(int(time.time()));nonce=uuid.uuid4().hex
        canonical='\n'.join(['POST',path,'eyeonads',stamp,nonce,hashlib.sha256(body).hexdigest()])
        request=urllib.request.Request('https://beta-buddy-service.vercel.app'+path,body,{'Content-Type':'application/json','X-Buddy-Product':'eyeonads','X-Buddy-Time':stamp,'X-Buddy-Nonce':nonce,'X-Buddy-Signature':hmac.new(self.secret.encode(),canonical.encode(),hashlib.sha256).hexdigest()})
        with self.opener.open(request,timeout=30) as response:
            raw=response.read(20001)
            if len(raw)>20000:raise ValueError('Worker response limit')
            return json.loads(raw)

def apply_proposal(source,patch):
    # The provider never executes anything. Git applies only to a disposable
    # single-file fixture, with no remote and no cloud/publisher environment.
    env={k:v for k,v in os.environ.items() if k.upper() in ('PATH','SYSTEMROOT','TEMP','TMP')}
    env.update(GIT_CONFIG_GLOBAL=os.devnull,GIT_CONFIG_NOSYSTEM='1',GIT_TERMINAL_PROMPT='0')
    with tempfile.TemporaryDirectory(prefix='buddy-apply-') as temporary:
        root=pathlib.Path(temporary);file=root/SOURCE;file.parent.mkdir(parents=True);file.write_text(source,encoding='utf-8')
        def git(*args):return subprocess.check_output(['git',*args],cwd=root,env=env,stderr=subprocess.DEVNULL,text=True,timeout=30).strip()
        git('init');git('add',SOURCE);git('-c','user.name=Buddy','-c','user.email=buddy@localhost','commit','-m','Explicit source fixture')
        patchfile=root/'proposal.patch';patchfile.write_text(patch,encoding='utf-8')
        git('apply','--check','--index',str(patchfile));git('apply','--index',str(patchfile))
        if git('diff','--cached','--name-only').splitlines()!=[SOURCE]:raise ValueError('Unregistered patch path')
        result=file.read_text(encoding='utf-8')
        expected="export function betaReadyLabel(ready: boolean): string { return ready ? 'Ready' : 'Checking'; }"
        if re.sub(r'\s+',' ',re.sub(r'//[^\n]*','',result).strip())!=expected:raise ValueError('Unregistered display change')
        return result

def run_once(client,publisher,codex,proof_path):
    value=client.request('claim',{})
    if not value.get('job'):return False
    job=value['job'];policy=value['policy'];scope={'id':job['id'],'lease':job['lease']};promoted=False
    try:
        if (policy['repository']!=REPOSITORY or policy['base_ref']!=RELEASE or policy['beta_origin']!=publisher.origin
            or policy['allowed_paths']!=[SOURCE] or set(policy['required_checks'])!=REQUIRED_CHECKS):raise ValueError('Operator policy mismatch')
        base=publisher.commit(RELEASE)['sha'];source=publisher.source(base)
        baseline=re.sub(r'\s+',' ',re.sub(r'//[^\n]*','',source).strip())
        if baseline!="export function betaReadyLabel(ready: boolean): string { return 'Checking'; }":raise ValueError('No registered reproducible defect')
        report=job['description']
        if not all(word.lower() in report.lower() for word in ('status','Checking','Ready')):raise ValueError('Report does not identify registered defect')
        generated=proposal(codex,report,{SOURCE:source},[SOURCE])
        if generated['decision']!='patch':raise ValueError('Provider requested review')
        text=apply_proposal(source,generated['patch'])
        candidate=publisher.candidate(base,text,job['id'])
        last_renew=[0.0]
        def renew():
            if time.monotonic()-last_renew[0]>90:client.request('renew',scope);last_renew[0]=time.monotonic()
        result=publisher.verify(base,candidate,job['id'],renew)
        if not qualifies(result,policy):raise ValueError('Independent checks did not qualify')
        renew();publisher.promote(base,candidate);promoted=True
        healthy=publisher.health(candidate,renew)
        release={'environment':'beta','origin':publisher.origin,'commit':candidate,'artifact_digest':result['artifact_digest'],'deployment_id':candidate,'healthy':healthy}
        if not healthy:
            restored=publisher.rollback(candidate,base)
            release.update(rolled_back=True,rollback_commit=restored,rollback_healthy=publisher.health(restored,renew))
        completed=client.request('finish',scope|{'verification':result,'release':release})
        # Evidence contains only fixture/job IDs, commit hashes and check results.
        proof_path.write_text(json.dumps({'report_id':job['id'],'verification':result,'release':release,'status':completed['status']},indent=2)+'\n')
        print('Beta job completed: '+completed['status'],flush=True)
    except Exception:
        # Do not reveal report text, provider output, HTTP bodies or credentials.
        # If a deployment outcome is uncertain, leave it for reconciliation.
        try:client.request('review',scope)
        except Exception:pass
        print('Beta job needs operator reconciliation' if promoted else 'Beta job needs operator review',flush=True)
    return True

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--config',required=True);parser.add_argument('--once',action='store_true');args=parser.parse_args()
    config=json.loads(pathlib.Path(args.config).read_text())
    # Credential files are private operator files, never repository content.
    secret=pathlib.Path(config['worker_secret_file']).read_text().strip()
    token=pathlib.Path(config['github_token_file']).read_text().strip()
    client=WorkerClient(secret);publisher=BetaPublisher(token,config['beta_origin'])
    while True:
        try:run_once(client,publisher,config['codex_executable'],pathlib.Path(config['proof_path']))
        except Exception:print('Beta worker connection needs operator attention',flush=True)
        if args.once:break
        time.sleep(30)
if __name__=='__main__':main()
