"""One-time source provisioning, restricted to the empty isolated beta repo.

Never loads .env files, ignored/untracked files, customer data or git history.
The independent workflow is bootstrapped separately by the operator in GitHub UI;
the runtime token needs Contents + Actions write, not Workflows permission.
"""
import argparse,base64,json,pathlib,re,subprocess
from beta_publisher import BetaPublisher,REPOSITORY
ROOTS=('src/','public/','tests/','services/beta-buddy/')
FILES={'package.json','package-lock.json','next.config.ts','postcss.config.mjs','tsconfig.json','eslint.config.mjs','.gitignore','.vercelignore','AGENTS.md'}
def manifest(root):
    names=subprocess.check_output(['git','-c','safe.directory='+root.as_posix(),'ls-files','--cached','--others','--exclude-standard'],cwd=root,text=True).splitlines()
    result=[]
    for name in names:
        if name not in FILES and not name.startswith(ROOTS):continue
        if any(part in ('__pycache__','node_modules','.next','.git') or part.startswith('.env') for part in pathlib.PurePosixPath(name).parts):raise ValueError('Private source path denied')
        if name.endswith(('.sqlite3','.db','.pyc')) or 'config.json' in name or 'operator' in name:continue
        file=root/name
        if file.is_symlink() or not file.resolve().is_relative_to(root) or file.stat().st_size>1000000:raise ValueError('Source file boundary')
        data=file.read_bytes()
        if re.search(rb'\b(?:github_pat_[A-Za-z0-9_]{20,}|sk[-_][A-Za-z0-9_-]{25,}|sb_secret_[A-Za-z0-9_-]+|eyJ[\w-]+\.[\w-]+\.[\w-]+)',data):raise ValueError('Credential-like source denied')
        result.append((name,data))
    if not any(name=='src/components/BetaReadyLabel.ts' for name,_ in result):raise ValueError('Registered display source missing')
    return result
def provision(publisher,root):
    base=publisher.commit('main')
    tree=publisher.api('/git/trees/'+base['commit']['tree']['sha']+'?recursive=1')['tree']
    if {item['path'] for item in tree if item['type']=='blob'}!={'README.md','.github/workflows/beta-buddy-repair.yml'}:raise ValueError('Repository already provisioned; no overwrite allowed')
    entries=[]
    for name,data in manifest(root):
        try:entries.append({'path':name,'mode':'100644','type':'blob','content':data.decode('utf-8')})
        except UnicodeDecodeError:
            blob=publisher.api('/git/blobs','POST',{'content':base64.b64encode(data).decode(),'encoding':'base64'})
            entries.append({'path':name,'mode':'100644','type':'blob','sha':blob['sha']})
    newtree=publisher.api('/git/trees','POST',{'base_tree':base['commit']['tree']['sha'],'tree':entries})
    commit=publisher.api('/git/commits','POST',{'message':'Provision isolated EyeOnAds beta and bounded Buddy worker','tree':newtree['sha'],'parents':[base['sha']]})['sha']
    publisher.api('/git/refs/heads/main','PATCH',{'sha':commit,'force':False})
    publisher.api('/git/refs','POST',{'ref':'refs/heads/beta-release','sha':commit})
    return {'repository':REPOSITORY,'commit':commit,'files':len(entries),'production_changed':False}
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--token-file',required=True);parser.add_argument('--source',required=True);parser.add_argument('--output',required=True);args=parser.parse_args()
    publisher=BetaPublisher(pathlib.Path(args.token_file).read_text().strip(),'https://eyeonads-isolated-beta.vercel.app')
    result=provision(publisher,pathlib.Path(args.source).resolve())
    pathlib.Path(args.output).write_text(json.dumps(result,indent=2)+'\n');print('Isolated beta source provisioned. No customer production source changed.')
