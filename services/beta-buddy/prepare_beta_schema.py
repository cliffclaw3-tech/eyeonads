"""Prepare (do not execute) an isolated, empty beta app schema installation.
No schedules, email triggers, production keys, data copy or auth users.
"""
import argparse,pathlib,re
parser=argparse.ArgumentParser();parser.add_argument('--source',required=True);parser.add_argument('--output',required=True);args=parser.parse_args()
root=pathlib.Path(args.source)
files=['schema.sql','migrations/20260923_owner_beta.sql','migrations/20260923_brokerage_roster.sql','migrations/20260923_public_discovery.sql',
 'migrations/20260923_discovery_jobs.sql','migrations/20260923_discovery_pilot.sql',
 'migrations/20260923_discovery_owned_claim.sql','migrations/20260923_discovery_evidence.sql',
 'migrations/20260923_discovery_office_scope.sql','migrations/20260923_report_schedules.sql',
 'migrations/20260923_scan_image_attachment.sql','migrations/20260923_scan_provenance.sql','migrations/20260923_monthly_reliability_canary.sql',
 'migrations/20261001_account_roles.sql','migrations/20261001_brokerage_offices.sql']
parts=["-- ONLY whmxiocdtulylddebjpm, the isolated beta database. Verify the dashboard project URL before running.\nBEGIN;\nDO $$ BEGIN\n IF to_regclass('public.user_profiles') IS NOT NULL THEN RAISE EXCEPTION 'App schema already exists; refuse overwrite'; END IF;\n IF NOT EXISTS (SELECT 1 FROM public.reports WHERE id='c249fea8-310a-4d22-be5e-5a38e9cda691' AND tenant='buddy-fixture-38a33e9088304f8cae917382b08e9b06') THEN RAISE EXCEPTION 'Verified isolated beta fixture missing'; END IF;\nEND $$;\n"]
for name in files:
    text=(root/'supabase'/name).read_text()
    text=re.sub(r'^\s*(?:BEGIN|COMMIT);\s*$', '',text,flags=re.M|re.I)
    if re.search(r'cron\.schedule|net\.http|vault\.',text,re.I):raise ValueError('External scheduling or secrets denied')
    parts.append('\n-- Source: supabase/'+name+'\n'+text)
parts.append('\nCOMMIT;\nNOTIFY pgrst,\'reload schema\';\n')
pathlib.Path(args.output).write_text('\n'.join(parts),encoding='utf-8',newline='\n')
print('Prepared isolated beta app schema; nothing executed.')
