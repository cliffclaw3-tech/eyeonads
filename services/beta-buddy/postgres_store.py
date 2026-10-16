"""Durable beta store. Schema installation is an explicit operator step.

Only a direct connection to the configured independent Supabase project is allowed.
No production DSN, pooled ambiguous host, connection options or schema bootstrap.
"""
import os, re

PRODUCTION_PROJECTS = {'vcdvqhchjxqnuuruobqg'}

def validate_connection(info, project):
    if not re.fullmatch(r'[a-z]{20}', project or '') or project in PRODUCTION_PROJECTS:
        raise ValueError('Independent beta project required')
    if info.get('host') != f'db.{project}.supabase.co':
        raise ValueError('Exact beta database host required')
    if info.get('dbname', 'postgres') != 'postgres' or str(info.get('port', '5432')) != '5432':
        raise ValueError('Unexpected database target')
    if set(info) - {'host','port','dbname','user','password','sslmode','connect_timeout'}:
        raise ValueError('Connection overrides denied')
    return dict(info, sslmode='verify-full', connect_timeout='10')

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
    info = validate_connection(conninfo_to_dict(os.environ['BUDDY_DATABASE_URL']), os.environ.get('BUDDY_DATABASE_PROJECT'))
    return PostgresStore(psycopg.connect(**info, autocommit=True, row_factory=row_factory))
