from pathlib import Path
import json
p=Path('database.rules.json')
rules=json.loads(p.read_text(encoding='utf-8'))
control=rules['rules']['rndControl']
crm="root.child('crmCompany/access').child(auth.uid)"
rnd="root.child('rndAccess').child(auth.uid)"
password=f"{crm}.child('mustChangePassword').val() !== true && {rnd}.child('mustChangePassword').val() !== true"
if password not in control['.read']:control['.read']+=' && '+password
roles=f"({crm}.child('role').val() === 'admin' || {crm}.child('role').val() === 'member' || {crm}.child('role').val() === 'viewer')"
read=f"auth != null && {crm}.child('enabled').val() === true && {crm}.child('email').val() === auth.token.email && {rnd}.child('enabled').val() === true && {rnd}.child('email').val() === auth.token.email && {rnd}.child('role').val() === {crm}.child('role').val() && {roles} && {password}"
control['importJobs']={'.read':read,'.write':False}
p.write_text(json.dumps(rules,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
