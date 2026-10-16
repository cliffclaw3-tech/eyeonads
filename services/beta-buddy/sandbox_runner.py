"""Reference isolated verifier for a coding-workflow patch proposal.
The coding workflow emits a patch; it never supplies commands, deployment credentials,
the attestation secret, trusted check definitions or permission to deploy.
Requires Docker and a prebuilt dependency/test image pinned by digest.
No production checkout is modified; clones are disposable and never pushed.
"""
import argparse,json,os,pathlib,re,subprocess,tempfile
from buddy import safe_paths

def run_proposal(config,patch):
    if config.get('environment')!='beta' or config.get('isolated_data') is not True:raise ValueError('Isolated beta only')
    image=config.get('test_image','')
    if not re.fullmatch(r'(?:[\w./:-]+@)?sha256:[a-f0-9]{64}',image):raise ValueError('Pinned test image required')
    repo=pathlib.Path(config['local_repository']).resolve()
    if not repo.is_dir():raise ValueError('Trusted source checkout unavailable')
    checks=config['checks']
    if not checks or any(not isinstance(v,list) or not v or any(not isinstance(arg,str) for arg in v) for v in checks.values()):raise ValueError('Trusted command arrays required')
    for name in ('reported_behavior','diff_security_review','tenant_isolation','production_denied'):
        if name not in checks or not any(arg.startswith('/checks/') for arg in checks[name]):raise ValueError('Independent pinned-image behavior and security checks required')
    # Minimal subprocess environment: no inherited model, cloud, database, git or deployment secrets.
    env={key:value for key,value in os.environ.items() if key.upper() in ('PATH','SYSTEMROOT','TEMP','TMP')}
    env.update({'GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':os.devnull,'GIT_TERMINAL_PROMPT':'0'})
    def execute(args,cwd,timeout=120):return subprocess.run(args,cwd=cwd,env=env,capture_output=True,text=True,timeout=timeout,check=True).stdout
    with tempfile.TemporaryDirectory(prefix='beta-buddy-') as tmp:
        root=pathlib.Path(tmp);clone=root/'candidate'
        execute(['git','clone','--no-hardlinks','--no-checkout','--',str(repo),str(clone)],root)
        base=config['base_commit']
        if not re.fullmatch(r'[a-f0-9]{40}',base):raise ValueError('Pinned base commit required')
        execute(['git','checkout','--detach',base],clone)
        patch_file=root/'proposal.patch';patch_file.write_text(patch,encoding='utf-8')
        execute(['git','apply','--check','--index',str(patch_file)],clone)
        stats=execute(['git','apply','--numstat',str(patch_file)],clone)
        paths=[]
        for line in stats.splitlines():
            added,removed,path=line.split('\t',2)
            if not added.isdigit() or not removed.isdigit():raise ValueError('Binary patch denied')
            paths.append(path)
        if not safe_paths(paths,config):raise ValueError('Patch exceeds approved repair scope')
        def isolated(command):
            return execute(['docker','run','--rm','--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=128','--memory=2g','--cpus=2','--user=65534:65534','--tmpfs=/tmp:rw,noexec,nosuid,size=256m','--mount',f'type=bind,source={clone},target=/workspace,readonly','--workdir=/workspace',image,*command],clone,300)
        try:
            isolated(checks['reported_behavior'])
            return {'isolated':True,'baseline_reproduced':False,'error':'Reported failure did not reproduce; review required'}
        except subprocess.CalledProcessError as error:
            if error.returncode!=23:raise ValueError('Baseline failed for an unknown reason; no repair attempted') from None
        execute(['git','apply','--index',str(patch_file)],clone)
        for p in paths:
            f=clone/p
            if not f.resolve().is_relative_to(clone.resolve()) or f.is_symlink() or (f.exists() and f.stat().st_size>200000):raise ValueError('Symlink or oversized change denied')
        outcomes={}
        for name,command in checks.items():
            try:
                isolated(command)
                outcomes[name]=True
            except (subprocess.SubprocessError,OSError):outcomes[name]=False
        if not all(outcomes.values()):return {'isolated':True,'sensitive_change':True,'changed_paths':paths,'checks':outcomes,'error':'Checks failed; operator review required'}
        execute(['git','-c','user.name=Beta Buddy','-c','user.email=beta-buddy@localhost','commit','-m','Verified beta repair candidate'],clone)
        commit=execute(['git','rev-parse','HEAD'],clone).strip()
        # Artifact is exported only to an operator-selected directory, never deployed here.
        output=pathlib.Path(config['artifact_directory']).resolve();output.mkdir(parents=True,exist_ok=True)
        bundle=output/(commit+'.bundle');execute(['git','bundle','create',str(bundle),'HEAD'],clone)
        import hashlib
        return {'isolated':True,'baseline_reproduced':True,'sensitive_change':False,'changed_paths':paths,'checks':outcomes,'commit':commit,'artifact_digest':hashlib.sha256(bundle.read_bytes()).hexdigest()}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--config',required=True);p.add_argument('--patch',required=True);a=p.parse_args()
    print(json.dumps(run_proposal(json.load(open(a.config,encoding='utf-8')),pathlib.Path(a.patch).read_text(encoding='utf-8'))))
