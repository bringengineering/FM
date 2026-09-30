# Immutable admin restore approval tied to records in the same atomic write.
from pathlib import Path
import json
p=Path('database.rules.json');rules=json.loads(p.read_text(encoding='utf-8'));rnd=rules['rules']['rndControl']
crm="root.child('crmCompany/access').child(auth.uid)";grant="root.child('rndAccess').child(auth.uid)"
admin_access="auth != null && "+crm+".child('enabled').val() === true && "+crm+".child('email').val() === auth.token.email && "+crm+".child('role').val() === 'admin' && "+grant+".child('enabled').val() === true && "+grant+".child('email').val() === auth.token.email && "+grant+".child('role').val() === 'admin'"
fields=['id','kind','version','actorUid','at','reason','backupArchiveSHA256','atomicPlanSHA256','snapshotSHA256']
checks=["newData.hasChildren("+json.dumps(fields)+")","newData.child('id').val() === $op","$op.matches(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)","newData.child('kind').val() === 'metadata-restore'","newData.child('version').val() === 1","newData.child('actorUid').val() === auth.uid","newData.child('at').isString()","newData.child('reason').isString() && newData.child('reason').val().length > 0 && newData.child('reason').val().length <= 4000","newData.child('projects').exists() || newData.child('visits').exists()"]
for f in ['backupArchiveSHA256','atomicPlanSHA256','snapshotSHA256']:checks.append("newData.child('"+f+"').isString() && newData.child('"+f+"').val().matches(/^[0-9a-f]{64}$/)")
audit={'.write':admin_access+' && !data.exists() && newData.exists()','.validate':' && '.join('('+c+')' for c in checks),'$other':{'.validate':False},**{f:{} for f in fields}}
for collection in ['projects','visits']:
 record="newData.parent().parent().parent().parent().child('"+collection+"').child($record)"
 old="root.child('rndControl/"+collection+"').child($record)"
 audit[collection]={'$record':{'.validate':"!"+old+".exists() && newData.hasChildren(['id','sourceRevision','sourceSHA256']) && newData.child('id').val() === $record && $record.matches(/^[a-zA-Z0-9_-]{1,128}$/) && newData.child('sourceRevision').isNumber() && newData.child('sourceRevision').val() >= 0 && newData.child('sourceRevision').val() % 1 === 0 && newData.child('sourceSHA256').isString() && newData.child('sourceSHA256').val().matches(/^[0-9a-f]{64}$/) && "+record+".child('id').val() === $record && "+record+".child('restoreApprovalId').val() === $op && "+record+".child('operationId').val() === $op && "+record+".child('revision').val() === 1 && "+record+".child('updatedBy').val() === auth.uid && "+record+".child('updatedAt').val() === newData.parent().parent().child('at').val()",'$other':{'.validate':False},**{f:{} for f in ['id','sourceRevision','sourceSHA256']}}}
 parent=rnd[collection]['$id'];approval="newData.parent().parent().parent().child('restoreApprovals').child(newData.val())"
 linked=admin_access+" && !data.parent().exists() && newData.isString() && "+approval+".child('actorUid').val() === auth.uid && "+approval+".child('"+collection+"').child($id).child('id').val() === $id"
 approved="auth != null && "+crm+".child('enabled').val() === true && "+crm+".child('email').val() === auth.token.email && ("+crm+".child('role').val() === 'admin' || "+crm+".child('role').val() === 'member') && "+grant+".child('enabled').val() === true && "+grant+".child('email').val() === auth.token.email && "+grant+".child('role').val() === "+crm+".child('role').val()"
 parent['restoreApprovalId']={'.write':'('+linked+') || ('+approved+" && data.exists() && newData.val() === data.val())",'.validate':"(data.exists() && newData.val() === data.val()) || ("+linked+")"}
 parent_approval="newData.parent().parent().child('restoreApprovals').child(newData.child('restoreApprovalId').val())"
 provenance="(!data.child('restoreApprovalId').exists() && !newData.child('restoreApprovalId').exists()) || (data.child('restoreApprovalId').exists() && newData.child('restoreApprovalId').val() === data.child('restoreApprovalId').val()) || (!data.exists() && "+admin_access+" && newData.child('restoreApprovalId').isString() && "+parent_approval+".child('actorUid').val() === auth.uid && "+parent_approval+".child('"+collection+"').child($id).child('id').val() === $id)"
 if provenance not in parent['.validate']:parent['.validate'] += ' && ('+provenance+')'

rnd['restoreApprovals']={'.write':False,'$op':audit}
p.write_text(json.dumps(rules,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
