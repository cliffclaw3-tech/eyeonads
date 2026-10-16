"""Serverless WSGI ingress. Repair work runs separately, never in a tester request."""
import json, logging, os
from buddy import authenticate, connect, submit, validate_config

def operator_failure(error, stage):
    """Log bounded operational codes, never exception messages or secret values."""
    state=getattr(error,'sqlstate',None)
    if state=='28P01':code='database_authentication'
    elif state=='42P01':code='database_schema'
    elif isinstance(error,json.JSONDecodeError):code='configuration_json'
    elif isinstance(error,KeyError):code='required_setting_missing'
    elif stage=='database' and isinstance(error,ValueError):code='database_target_guard'
    elif stage=='database':
        detail=str(error).lower() # Used only for classification; never emitted.
        code='database_authentication' if 'password authentication failed' in detail else 'database_certificate' if 'certificate' in detail else 'database_connection'
    else:code='configuration_guard' if stage=='configuration' else 'request_or_storage'
    logging.getLogger('beta_buddy').warning('buddy_unavailable stage=%s code=%s',stage,code)

def app(environ, start_response):
    code = 503
    value = {'error':'Support unavailable; retry later'}
    db = None
    db_ready = False
    stage = 'configuration'
    try:
        if os.environ.get('BUDDY_STORE') != 'postgres':
            raise ValueError('Serverless ingress requires durable storage')
        config = validate_config(json.loads(os.environ['BUDDY_CONFIG_JSON']))
        stage = 'routing'
        path = environ.get('PATH_INFO','')
        method = environ.get('REQUEST_METHOD','')
        if path == '/health' and method == 'GET':
            stage = 'database'
            db = connect(None)
            db.execute('SELECT 1').fetchone()
            code, value = 200, {'status':'ready','environment':'beta'}
        elif path in ('/v1/worker/claim','/v1/worker/finish','/v1/worker/review','/v1/worker/renew') and method=='POST':
            size=int(environ.get('CONTENT_LENGTH') or '0')
            if not 0<=size<=12000:raise ValueError('Worker body size')
            body=environ['wsgi.input'].read(size)
            if len(body)!=size:raise ValueError('Truncated body')
            headers={key[5:].replace('_','-').title():val for key,val in environ.items() if key.startswith('HTTP_')}
            stage='database';db=connect(None);db_ready=True;stage='request'
            from worker_api import authenticate_worker,worker_request
            product=authenticate_worker(db,config,path,headers,body)
            code,value=200,worker_request(db,config,path,product,json.loads(body))
        elif path not in ('/v1/reports','/v1/notifications'):
            code, value = 404, {'error':'Not found'}
        elif method not in ('GET','POST') or (method == 'POST' and path != '/v1/reports'):
            code, value = 405, {'error':'Method not allowed'}
        else:
            size = int(environ.get('CONTENT_LENGTH') or '0')
            if size < 0 or size > 12000:
                code, value = 413, {'error':'Too large'}
            else:
                body = environ['wsgi.input'].read(size)
                if len(body) != size: raise ValueError('Truncated body')
                headers = {key[5:].replace('_','-').title(): val for key,val in environ.items() if key.startswith('HTTP_')}
                stage = 'database'
                db = connect(None)
                db_ready = True
                stage = 'request'
                who = authenticate(db,config,method,path,headers,body)
                if method == 'POST':
                    code, value = 201, submit(db,config,who,json.loads(body))
                elif path == '/v1/notifications':
                    code, value = 200, {'notifications':[dict(r) for r in db.execute('SELECT id,message FROM notifications WHERE product=? AND tenant=? AND user=? ORDER BY created DESC LIMIT 20',who)]}
                else:
                    code, value = 200, {'reports':[dict(r) for r in db.execute('SELECT id,kind,status,created FROM reports WHERE product=? AND tenant=? AND user=? ORDER BY created DESC LIMIT 20',who)]}
    except OverflowError:
        code, value = 429, {'error':'Report limit reached'}
    except (ValueError, KeyError, TypeError) as error:
        if not db_ready:operator_failure(error,stage)
        code, value = (400, {'error':'Invalid or unauthorized request'}) if db_ready else (503, {'error':'Support unavailable; retry later'})
    except Exception as error:
        operator_failure(error,stage)
    finally:
        if db: db.close()
    raw = json.dumps(value).encode()
    labels = {200:'OK',201:'Created',400:'Bad Request',404:'Not Found',405:'Method Not Allowed',413:'Content Too Large',429:'Too Many Requests',503:'Service Unavailable'}
    start_response(f'{code} {labels[code]}',[('Content-Type','application/json'),('Cache-Control','no-store'),('Content-Length',str(len(raw)))])
    return [raw]
