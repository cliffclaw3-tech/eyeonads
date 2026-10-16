"""Real Postgres tests, disposable loopback-only CI database; never cloud data."""
import concurrent.futures, os, pathlib, unittest, uuid
import test_buddy
from buddy import claim, submit
from postgres_store import PostgresStore, row_factory

@unittest.skipUnless(os.environ.get('BUDDY_TEST_DATABASE_DSN'), 'Disposable Postgres fixture unavailable')
class PostgresTests(test_buddy.BuddyTests):
    @classmethod
    def setUpClass(cls):
        import psycopg
        from psycopg import sql
        from psycopg.conninfo import conninfo_to_dict
        cls.info=conninfo_to_dict(os.environ['BUDDY_TEST_DATABASE_DSN'])
        if cls.info.get('host') not in ('127.0.0.1','localhost','::1'):
            raise ValueError('Test database must be disposable loopback infrastructure')
        cls.name='buddy_test_'+uuid.uuid4().hex
        with psycopg.connect(**cls.info,autocommit=True) as admin:
            admin.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(cls.name)))
            for role in ('anon','authenticated'):
                if not admin.execute('SELECT 1 FROM pg_roles WHERE rolname=%s',(role,)).fetchone():
                    admin.execute(sql.SQL('CREATE ROLE {} NOLOGIN').format(sql.Identifier(role)))
        cls.info['dbname']=cls.name
        with psycopg.connect(**cls.info,autocommit=True) as db:
            db.execute(pathlib.Path(__file__).with_name('postgres_schema.sql').read_text())

    @classmethod
    def tearDownClass(cls):
        import psycopg
        from psycopg import sql
        info=dict(cls.info,dbname='postgres')
        with psycopg.connect(**info,autocommit=True) as admin:
            admin.execute(sql.SQL('DROP DATABASE {}').format(sql.Identifier(cls.name)))

    def store(self):
        import psycopg
        return PostgresStore(psycopg.connect(**self.info,autocommit=True,row_factory=row_factory))

    def setUp(self):
        super().setUp();self.db.close();self.db=self.store()
        self.db.execute('TRUNCATE reports,nonces,events,notifications')

    def test_parallel_dedup_and_single_claim(self):
        def add(_):
            db=self.store()
            try:return submit(db,self.config,('eyeonads','tenant-a','user-a'),{'kind':'bug','description':'The blue button does nothing when clicked','consent':True,'page':'/broker'})['id']
            finally:db.close()
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
            ids=list(executor.map(add,range(12)))
        self.assertEqual(len(set(ids)),1)
        def lease(_):
            db=self.store()
            try:return claim(db)
            finally:db.close()
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
            results=list(executor.map(lease,range(12)))
        self.assertEqual(sum(r is not None for r in results),1)

    def test_reconnect_persistence_and_no_browser_role_access(self):
        report=self.report();self.db.close();self.db=self.store()
        self.assertEqual(self.db.execute('SELECT status FROM reports WHERE id=?',(report['id'],)).fetchone()['status'],'queued')
        rows=self.db.execute("SELECT tablename,rowsecurity,has_table_privilege('anon','public.'||quote_ident(tablename),'SELECT') AS anon_read,has_table_privilege('authenticated','public.'||quote_ident(tablename),'SELECT') AS tester_read FROM pg_tables WHERE schemaname='public'").fetchall()
        self.assertEqual(len(rows),4)
        self.assertTrue(all(r['rowsecurity'] and not r['anon_read'] and not r['tester_read'] for r in rows))

if __name__=='__main__':unittest.main()
