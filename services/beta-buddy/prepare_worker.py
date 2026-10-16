"""Prepare private worker files only after the exact beta origin is observed."""
import argparse,json,pathlib,secrets
from beta_publisher import BetaPublisher,REPOSITORY,RELEASE,SOURCE
from buddy import REQUIRED_CHECKS
parser=argparse.ArgumentParser();parser.add_argument('--operator-directory',required=True);parser.add_argument('--beta-origin',required=True);parser.add_argument('--codex',required=True);parser.add_argument('--proof',required=True);args=parser.parse_args()
# Validate target without an actual token. No network request occurs here.
BetaPublisher('github_pat_validation_only',args.beta_origin)
directory=pathlib.Path(args.operator_directory).resolve(strict=True)
if (directory/'.git').exists() or directory.is_relative_to(pathlib.Path(__file__).resolve().parent):raise ValueError('Private directory outside source required')
existing=directory/'beta-buddy-service.env'
line=next(x for x in existing.read_text().splitlines() if x.startswith('BUDDY_CONFIG_JSON='))
config=json.loads(line.split('=',1)[1].strip().strip("'"))
secretfile=directory/'worker-secret.txt'
if not secretfile.exists():secretfile.write_text(secrets.token_hex(32))
secret=secretfile.read_text().strip()
config['worker_products']=['eyeonads']
config['products']['eyeonads'].update(worker_mode='poll',repository=REPOSITORY,base_ref=RELEASE,beta_origin=args.beta_origin,
    allowed_paths=[SOURCE],required_checks=sorted(REQUIRED_CHECKS),runner_url='',deployer_url='')
(directory/'worker-service-setup.env').write_text("BUDDY_WORKER_SECRET='"+secret+"'\nBUDDY_CONFIG_JSON='"+json.dumps(config,separators=(',',':'))+"'\n")
tokenfile=directory/'github-token.txt'
if not tokenfile.exists():tokenfile.write_text('')
(directory/'worker-config.json').write_text(json.dumps({'worker_secret_file':str(secretfile),'github_token_file':str(tokenfile),
    'beta_origin':args.beta_origin,'codex_executable':args.codex,'proof_path':args.proof},indent=2)+'\n')
print('Private worker configuration prepared. Import the two service variables directly; do not paste credentials in chat.')
