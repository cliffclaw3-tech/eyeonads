"""Execute a real Docker verifier on a synthetic provider-produced patch."""
import json, pathlib, subprocess, sys, tempfile
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
from buddy import REQUIRED_CHECKS
from sandbox_runner import run_proposal
with tempfile.TemporaryDirectory(prefix='buddy-fixture-') as temporary:
    root=pathlib.Path(temporary);repo=root/'source';repo.mkdir();(repo/'fixture').mkdir()
    (repo/'fixture/status.py').write_text('def label(loading: bool) -> str:\n    return "Loading"\n')
    def git(*args):return subprocess.check_output(['git',*args],cwd=repo,text=True).strip()
    git('init');git('add','fixture/status.py');git('-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','-m','Synthetic baseline')
    config={'environment':'beta','isolated_data':True,'test_image':sys.argv[1], 'local_repository':str(repo),'base_commit':git('rev-parse','HEAD'),'artifact_directory':str(root/'artifacts'),'allowed_paths':['fixture/'],'checks':{name:['python','/checks/check.py',name] for name in REQUIRED_CHECKS}}
    rejected=run_proposal(config,pathlib.Path(__file__).with_name('rejected-proposal.patch').read_text())
    if rejected.get('baseline_reproduced') or all(rejected.get('checks',{}).values()):raise SystemExit('Wrong proposal unexpectedly qualified')
    print('Incorrect model proposal rejected by independent behavior/security checks')
    result=run_proposal(config,pathlib.Path(__file__).with_name('proposal.patch').read_text())
    print(json.dumps(result,sort_keys=True))
    if not result.get('baseline_reproduced') or not all(result.get('checks',{}).values()):raise SystemExit(1)
