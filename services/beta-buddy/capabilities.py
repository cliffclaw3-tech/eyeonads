"""Human product capabilities. Buddy never inherits owner/admin privileges."""
FORBIDDEN_AUTOMATION={'bank_accounts.manage','money.move','ownership.change','access.grant','credentials.change','billing.manage','data.delete','contract.override'}

def can_act(policy,role,actor_org,resource_org,capability,actor_type='human'):
    if not actor_org or actor_org!=resource_org:return False
    if actor_type!='human':return False  # Repairs have a separate beta-only deployment policy.
    return capability in policy.get(role,[])

def override_audit(actor_id,role,org,resource_org,resource_id,capability,reason,policy,before_hash,after_hash):
    if not can_act(policy,role,org,resource_org,capability):raise PermissionError('Denied')
    if not reason.strip() or len(reason)>500:raise ValueError('A short reason is required')
    import re
    if not all(re.fullmatch(r'[a-f0-9]{64}',s) for s in (before_hash,after_hash)):raise ValueError('Use value hashes, not private content')
    from buddy import redact
    from datetime import datetime,timezone
    return {'actor_id':actor_id,'role':role,'organization':org,'resource_id':resource_id,'capability':capability,'reason':redact(reason),'before_hash':before_hash,'after_hash':after_hash,'timestamp':datetime.now(timezone.utc).isoformat()}
