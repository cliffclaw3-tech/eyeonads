"""Durable beta store. Schema installation is an explicit operator step.

Only the exact configured independent Supabase target is allowed. A session
pooler additionally requires an operator-pinned host and project-bound username.
No production DSN, ambiguous pooler identity, options or schema bootstrap.
"""
import hashlib, os, pathlib, re

PRODUCTION_PROJECTS = {'vcdvqhchjxqnuuruobqg'}
CA_FILE = pathlib.Path(__file__).resolve().parent/'certificates'/'supabase-ca-2021.crt'
CA_SHA256 = '700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7'

def validate_connection(info, project, pooler_host=None):
    if not re.fullmatch(r'[a-z]{20}', project or '') or project in PRODUCTION_PROJECTS:
        raise ValueError('Independent beta project required')
    if pooler_host:
        if not re.fullmatch(r'aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com',pooler_host) or info.get('host')!=pooler_host or info.get('user')!=f'postgres.{project}':
            raise ValueError('Exact beta pooler host and project identity required')
    elif info.get('host') != f'db.{project}.supabase.co':
        raise ValueError('Exact beta database host required')
    if info.get('dbname', 'postgres') != 'postgres' or str(info.get('port', '5432')) != '5432':
        raise ValueError('Unexpected database target')
    if set(info) - {'host','port','dbname','user','password','sslmode','connect_timeout'}:
        raise ValueError('Connection overrides denied')
    if hashlib.sha256(CA_FILE.read_bytes()).hexdigest()!=CA_SHA256:
        raise ValueError('Trusted database CA unavailable')
    return dict(info, sslmode='verify-full', sslrootcert=str(CA_FILE), connect_timeout='10')

class Row(dict):
    def __getitem__(self, key):
        return list(self.values())[key] if isinstance(key, int) else super().__getitem__(key)

def row_factory(cursor):
    names = [column.name for column in cursor.description] if cursor.description else []
    return lambda values: Row(zip(names, values))

class PostgresStore:
    def __init__(self, connection):
        self.connection = connection

    def execute(self, statement, parameters=()):
        # All statements originate in buddy.py, never from a report or model.
        if parameters:
            statement = statement.replace('%', '%%')
        statement = statement.replace('?', '%s')
        statement = re.sub(r'\buser\b', '"user"', statement)
        if statement == 'BEGIN IMMEDIATE':
            self.connection.execute('BEGIN')
            return self.connection.execute("SELECT pg_advisory_xact_lock(198431, 1)")
        if statement.startswith('INSERT OR IGNORE INTO notifications'):
            statement = statement.replace('INSERT OR IGNORE', 'INSERT', 1) + ' ON CONFLICT DO NOTHING'
        try:
            return self.connection.execute(statement, parameters) if parameters else self.connection.execute(statement)
        except Exception as error:
            # Preserve the ingestion API's replay rejection across both stores.
            if getattr(error, 'sqlstate', None) == '23505' and statement.startswith('INSERT INTO nonces'):
                import sqlite3
                raise sqlite3.IntegrityError('Replay rejected') from None
            raise

    def close(self):
        self.connection.close()

def connect_postgres():
    if os.environ.get('BUDDY_ENVIRONMENT') != 'beta' or os.environ.get('BUDDY_ISOLATED_DATA') != '1':
        raise ValueError('Isolated beta storage required')
    import psycopg
    from psycopg.conninfo import conninfo_to_dict
    project=os.environ.get('BUDDY_DATABASE_PROJECT')
    pooler=os.environ.get('BUDDY_DATABASE_POOLER_HOST')
    if os.environ.get('BUDDY_DATABASE_URL'):
        supplied=conninfo_to_dict(os.environ['BUDDY_DATABASE_URL'])
    else:
        supplied={'host':pooler or f'db.{project}.supabase.co','port':'5432','dbname':'postgres','user':f'postgres.{project}' if pooler else 'postgres','password':os.environ['BUDDY_DATABASE_PASSWORD']}
    info = validate_connection(supplied,project,pooler)
    return PostgresStore(psycopg.connect(**info, autocommit=True, row_factory=row_factory))
