#!/usr/bin/env python3
"""D1-compatible SQLite adapter for finite tests; never touches the live database."""
import sys,json,sqlite3,pathlib
request=json.load(sys.stdin);database=request['database'];conn=sqlite3.connect(database);conn.row_factory=sqlite3.Row;conn.execute('PRAGMA foreign_keys=ON')
def execute(item):
 before=conn.total_changes;cursor=conn.execute(item['sql'],item.get('params',[]));rows=[dict(row) for row in cursor.fetchall()] if cursor.description else [];return {'success':True,'results':rows,'meta':{'changes':conn.total_changes-before,'last_row_id':cursor.lastrowid,'duration':0}}
try:
 if request.get('setup'):
  for migration in sorted(pathlib.Path(request['setup']).glob('*.sql')):conn.executescript(migration.read_text())
  conn.commit();response={'success':True}
 elif request.get('batch') is not None:
  with conn:response=[execute(item) for item in request['batch']]
 elif request.get('exec'):
  conn.executescript(request['exec']);conn.commit();response={'success':True}
 else:
  response=execute(request);conn.commit()
 print(json.dumps(response))
except Exception as error:
 conn.rollback();print(json.dumps({'error':str(error)}));sys.exit(1)
finally:conn.close()
