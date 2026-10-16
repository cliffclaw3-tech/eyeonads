"""Install/test the beta app schema only in a disposable loopback CI database.
Supabase auth helpers are represented by deterministic fixture SQL functions.
This tests schema/RLS behavior, not Supabase's hosted authentication service.
"""
import json,os,pathlib,subprocess,sys,tempfile,unittest,uuid
@unittest.skipUnless(os.environ.get('BUDDY_TEST_DATABASE_DSN'),'Disposable Postgres fixture unavailable')
class BetaSchemaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import psycopg
        from psycopg import sql
        from psycopg.conninfo import conninfo_to_dict
        cls.info=conninfo_to_dict(os.environ['BUDDY_TEST_DATABASE_DSN'])
        if cls.info.get('host') not in ('127.0.0.1','localhost','::1'):raise ValueError('Disposable loopback only')
        cls.name='buddy_app_test_'+uuid.uuid4().hex
        with psycopg.connect(**cls.info,autocommit=True) as admin:
            admin.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(cls.name)))
            for role in ('anon','authenticated','service_role'):
                if not admin.execute('SELECT 1 FROM pg_roles WHERE rolname=%s',(role,)).fetchone():admin.execute(sql.SQL('CREATE ROLE {} NOLOGIN').format(sql.Identifier(role)))
        cls.info['dbname']=cls.name;directory=pathlib.Path(__file__).resolve().parent
        with psycopg.connect(**cls.info,autocommit=True) as db:
            db.execute("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}',raw_app_meta_data jsonb DEFAULT '{}');")
            db.execute("CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_user::text $$; CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$; GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;")
            db.execute("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;")
            db.execute(directory.joinpath('postgres_schema.sql').read_text())
            db.execute("INSERT INTO reports(id,product,tenant,\"user\",kind,description,page,diagnostics,fingerprint,status,created,updated) VALUES('c249fea8-310a-4d22-be5e-5a38e9cda691','eyeonads','buddy-fixture-38a33e9088304f8cae917382b08e9b06','fixture','feature','synthetic','/other','[]','fixture','feature_review',1,1)")
            with tempfile.TemporaryDirectory() as temporary:
                output=pathlib.Path(temporary)/'schema.sql'
                subprocess.run([sys.executable,str(directory/'prepare_beta_schema.py'),'--source',str(directory.parents[1]),'--output',str(output)],check=True)
                db.execute(output.read_text())
            cls.users=[str(uuid.uuid4()) for _ in range(3)]
            for index,user in enumerate(cls.users):db.execute('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(%s,%s,%s)',(user,'fixture-'+str(index)+'@example.invalid',json.dumps({'role':'agent' if index==1 else 'broker'})))
    @classmethod
    def tearDownClass(cls):
        import psycopg
        from psycopg import sql
        with psycopg.connect(**dict(cls.info,dbname='postgres'),autocommit=True) as admin:admin.execute(sql.SQL('DROP DATABASE {}').format(sql.Identifier(cls.name)))
    def as_user(self,index):
        import psycopg
        db=psycopg.connect(**self.info,autocommit=True);db.execute('SET ROLE authenticated')
        db.execute("SELECT set_config('request.jwt.claim.sub',%s,false)",(self.users[index],))
        db.execute("SELECT set_config('request.jwt.claims',%s,false)",(json.dumps({'sub':self.users[index],'app_metadata':{}}),))
        return db
    def test_broker_rosters_remain_account_scoped_and_agents_cannot_create_one(self):
        import psycopg
        for index in (0,2):
            with self.as_user(index) as db:db.execute("INSERT INTO eyeonads_brokerage_setups(owner_id,name,expected_agents,scope) VALUES(%s,'Synthetic beta firm',1,'both')",(self.users[index],))
        with self.as_user(0) as db:self.assertEqual(db.execute('SELECT count(*) FROM eyeonads_brokerage_setups').fetchone()[0],1)
        with self.as_user(1) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM eyeonads_brokerage_setups').fetchone()[0],0)
            with self.assertRaises(psycopg.errors.InsufficientPrivilege):db.execute("INSERT INTO eyeonads_brokerage_setups(owner_id,name,expected_agents,scope) VALUES(%s,'Denied',1,'both')",(self.users[1],))
    def test_agent_profile_edit_cannot_promote_authoritative_role_or_read_buddy(self):
        import psycopg
        with self.as_user(1) as db:
            db.execute("UPDATE user_profiles SET role='broker' WHERE id=%s",(self.users[1],))
            self.assertFalse(db.execute('SELECT eyeonads_current_broker()').fetchone()[0])
            # Supabase default grants may permit the SQL verb; RLS must still
            # prevent any authoritative role row from changing.
            try:self.assertEqual(db.execute("UPDATE eyeonads_account_roles SET role='broker' WHERE user_id=%s",(self.users[1],)).rowcount,0)
            except psycopg.errors.InsufficientPrivilege:pass
            self.assertFalse(db.execute('SELECT eyeonads_current_broker()').fetchone()[0])
            with self.assertRaises(psycopg.errors.InsufficientPrivilege):db.execute('SELECT * FROM reports')
