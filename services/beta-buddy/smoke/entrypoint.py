import os, shutil, subprocess, sys
shutil.copytree('/workspace','/tmp/candidate')
os.chdir('/tmp/candidate')
raise SystemExit(subprocess.run(sys.argv[1:],env={'PATH':os.environ['PATH'],'HOME':'/tmp','PYTHONDONTWRITEBYTECODE':'1'}).returncode)
