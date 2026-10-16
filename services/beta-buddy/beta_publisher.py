"""Publisher with one immutable repository boundary and no Vercel/admin token.

A repository-scoped GitHub token can publish only the separate public beta repo.
Vercel tracks beta-release. CI is read-only and receives no publisher credential.
"""
import base64,hashlib,io,json,re,time,urllib.error,urllib.parse,urllib.request,zipfile
REPOSITORY='cliffclaw3-tech/eyeonads-isolated-beta'
RELEASE='beta-release'
WORKFLOW='beta-buddy-repair.yml'
SOURCE='src/components/BetaReadyLabel.ts'
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

class BetaPublisher:
    def __init__(self,token,origin):
        if not token.startswith('github_pat_'):raise ValueError('Repository-scoped fine-grained token required')
        url=urllib.parse.urlsplit(origin)
        if (url.scheme!='https' or url.username or url.password or url.path not in ('','/') or url.query or url.fragment
            or not re.fullmatch(r'eyeonads-isolated-beta(?:-git-beta-release-[a-z0-9-]+)?\.vercel\.app',url.hostname or '')):
            raise ValueError('Exact separate beta hosting required')
        self.token=token;self.origin=origin.rstrip('/');self.opener=urllib.request.build_opener(NoRedirect())
    def api(self,path,method='GET',value=None,raw=False):
        # Every authenticated call stays inside the ONE isolated repository.
        if not path.startswith('/') or '..' in path or '://' in path:raise ValueError('Invalid repository API path')
        data=None if value is None else json.dumps(value).encode()
        request=urllib.request.Request('https://api.github.com/repos/'+REPOSITORY+path,data,{'Authorization':'Bearer '+self.token,'Accept':'application/vnd.github+json','Content-Type':'application/json','User-Agent':'BetaBuddy-scoped-worker'},method=method)
        try:
            with self.opener.open(request,timeout=30) as response:
                body=response.read(8000001)
                if len(body)>8000000:raise ValueError('API response limit')
                return body if raw else json.loads(body) if body else None
        except urllib.error.HTTPError as error:
            # GitHub response bodies can contain echoed values. Do not log them.
            raise RuntimeError('Beta repository API unavailable: HTTP '+str(error.code)) from None
    def commit(self,ref):return self.api('/commits/'+urllib.parse.quote(ref,safe=''))
    def source(self,commit):
        value=self.api('/contents/'+SOURCE+'?ref='+commit)
        if value.get('type')!='file' or value.get('size',0)>20000:raise ValueError('Source scope')
        return base64.b64decode(value['content']).decode()
    def candidate(self,base,text,job):
        if not re.fullmatch(r'[a-f0-9]{40}',base) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',job):raise ValueError('Pinned candidate identity')
        original=self.commit(base)
        tree=self.api('/git/trees','POST',{'base_tree':original['commit']['tree']['sha'],'tree':[{'path':SOURCE,'mode':'100644','type':'blob','content':text}]})
        result=self.api('/git/commits','POST',{'message':'Beta Buddy verified-candidate proposal '+job,'tree':tree['sha'],'parents':[base]})
        self.api('/git/refs','POST',{'ref':'refs/heads/buddy-candidate-'+job,'sha':result['sha']})
        return result['sha']
    def verify(self,base,candidate,job,heartbeat=lambda:None,timeout=1000):
        trusted=self.commit('main')['sha']
        self.api('/actions/workflows/'+WORKFLOW+'/dispatches','POST',{'ref':'main','inputs':{'base':base,'candidate':candidate,'job_id':job}})
        deadline=time.monotonic()+timeout;run=None
        while time.monotonic()<deadline:
            heartbeat()
            runs=self.api('/actions/workflows/'+WORKFLOW+'/runs?event=workflow_dispatch&per_page=30')['workflow_runs']
            matches=[r for r in runs if r.get('display_title')=='Buddy '+job+' '+candidate]
            if len(matches)>1:raise ValueError('Ambiguous verification run')
            if matches:
                run=matches[0]
                if run['head_sha']!=trusted:raise ValueError('Trusted workflow changed')
                if run['status']=='completed':break
            time.sleep(15)
        if not run or run['status']!='completed' or run['conclusion']!='success':raise ValueError('Independent CI did not pass')
        artifacts=self.api('/actions/runs/'+str(run['id'])+'/artifacts')['artifacts']
        matches=[x for x in artifacts if x['name']=='verified-beta-candidate' and not x['expired']]
        if len(matches)!=1:raise ValueError('Verified artifact unavailable')
        request=urllib.request.Request('https://api.github.com/repos/'+REPOSITORY+'/actions/artifacts/'+str(matches[0]['id'])+'/zip',headers={'Authorization':'Bearer '+self.token,'User-Agent':'BetaBuddy-scoped-worker'})
        try:self.opener.open(request,timeout=30)
        except urllib.error.HTTPError as error:
            if error.code!=302:raise RuntimeError('Artifact download unavailable') from None
            location=error.headers.get('Location','')
        else:raise ValueError('Expected signed artifact download')
        url=urllib.parse.urlsplit(location)
        if url.scheme!='https' or url.username or url.password or not (url.hostname or '').endswith('.blob.core.windows.net'):raise ValueError('Unexpected artifact host')
        # Fresh request deliberately carries NO GitHub token to the signed host.
        with urllib.request.urlopen(location,timeout=30) as response:raw=response.read(8000001)
        if len(raw)>8000000:raise ValueError('Artifact limit')
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            if set(archive.namelist())!={'attestation.json','candidate.bundle'} or sum(x.file_size for x in archive.infolist())>10000000:raise ValueError('Artifact contents')
            attestation=json.loads(archive.read('attestation.json'));bundle=archive.read('candidate.bundle')
        if attestation.get('commit')!=candidate or attestation.get('base_commit')!=base or attestation.get('artifact_digest')!=hashlib.sha256(bundle).hexdigest():raise ValueError('Artifact identity mismatch')
        return attestation|{'workflow_run':run['id']}
    def promote(self,base,candidate):
        if self.commit(RELEASE)['sha']!=base:raise ValueError('Beta changed during verification')
        self.api('/git/refs/heads/'+RELEASE,'PATCH',{'sha':candidate,'force':False})
    def rollback(self,failed,previous):
        if self.commit(RELEASE)['sha']!=failed:raise ValueError('Beta changed; operator reconciliation required')
        tree=self.commit(previous)['commit']['tree']['sha']
        restored=self.api('/git/commits','POST',{'message':'Restore previous isolated beta after failed health check','tree':tree,'parents':[failed]})['sha']
        self.api('/git/refs/heads/'+RELEASE,'PATCH',{'sha':restored,'force':False})
        return restored
    def health(self,commit,heartbeat=lambda:None,timeout=360):
        deadline=time.monotonic()+timeout
        while time.monotonic()<deadline:
            heartbeat()
            try:
                with self.opener.open(self.origin+'/api/beta-health',timeout=15) as response:value=json.load(response)
                if value.get('commit')==commit and value.get('environment')=='beta' and value.get('isolated') is True and value.get('ready') is True:return True
            except (OSError,ValueError):pass
            time.sleep(10)
        return False
