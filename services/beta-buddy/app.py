"""Serverless WSGI ingress. Repair work runs separately, never in a tester request."""
import json, os
from buddy import authenticate, connect, submit, validate_config

def app(environ, start_response):
    code = 503
    value = {'error':'Support unavailable; retry later'}
    db = None
    db_ready = False
    try:
        if os.environ.get('BUDDY_STORE') != 'postgres':
            raise ValueError('Serverless ingress requires durable storage')
        config = validate_config(json.loads(os.environ['BUDDY_CONFIG_JSON']))
        path = environ.get('PATH_INFO','')
        method = environ.get('REQUEST_METHOD','')
        if path == '/health' and method == 'GET':
            db = connect(None)
            db.execute('SELECT 1').fetchone()
            code, value = 200, {'status':'ready','environment':'beta'}
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
                db = connect(None)
                db_ready = True
                who = authenticate(db,config,method,path,headers,body)
                if method == 'POST':
                    code, value = 201, submit(db,config,who,json.loads(body))
                elif path == '/v1/notifications':
                    code, value = 200, {'notifications':[dict(r) for r in db.execute('SELECT id,message FROM notifications WHERE product=? AND tenant=? AND user=? ORDER BY created DESC LIMIT 20',who)]}
                else:
                    code, value = 200, {'reports':[dict(r) for r in db.execute('SELECT id,kind,status,created FROM reports WHERE product=? AND tenant=? AND user=? ORDER BY created DESC LIMIT 20',who)]}
    except OverflowError:
        code, value = 429, {'error':'Report limit reached'}
    except (ValueError, KeyError, TypeError):
        code, value = (400, {'error':'Invalid or unauthorized request'}) if db_ready else (503, {'error':'Support unavailable; retry later'})
    except Exception:
        pass
    finally:
        if db: db.close()
    raw = json.dumps(value).encode()
    labels = {200:'OK',201:'Created',400:'Bad Request',404:'Not Found',405:'Method Not Allowed',413:'Content Too Large',429:'Too Many Requests',503:'Service Unavailable'}
    start_response(f'{code} {labels[code]}',[('Content-Type','application/json'),('Cache-Control','no-store'),('Content-Length',str(len(raw)))])
    return [raw]
