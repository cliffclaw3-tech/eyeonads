"""Read-only pattern scan. Never print matching values or source lines."""
from pathlib import Path
import re, subprocess
paths=set(filter(None,subprocess.check_output(['git','ls-files','-c','-o','--exclude-standard','-z']).decode().split('\0')))
paths.update(str(p) for p in Path('.').glob('.env*') if p.is_file())
patterns={
 'private-key':re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
 'provider-secret':re.compile(r'(?:sk_(?:live|test)_[A-Za-z0-9]{12,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,})'),
 'jwt-shaped':re.compile(r'eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}'),
 'credential-assignment':re.compile(r'''(?im)^\s*(?:[A-Z_]*(?:SECRET|PASSWORD|SERVICE_ROLE_KEY|API_KEY|ACCESS_TOKEN))\s*=\s*["']?[^\s"']{8,}'''),
}
count=0
for filename in sorted(paths):
 p=Path(filename)
 if not p.is_file() or p.stat().st_size>2_000_000: continue
 try: content=p.read_text()
 except UnicodeError: continue
 count+=1
 for label,pattern in patterns.items():
  if pattern.search(content): print(f'{filename}: {label}')
print(f'Scanned {count} text files. Pattern matches require review; absence is not proof of no secret.')
