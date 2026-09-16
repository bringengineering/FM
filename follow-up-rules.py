def install_follow_up_rules(project, access, admin):
 import json
 date_pattern=r'([0-9]{4}-((0[13578]|1[02])-(0[1-9]|[12][0-9]|3[01])|(0[469]|11)-(0[1-9]|[12][0-9]|30)|02-(0[1-9]|1[0-9]|2[0-8]))|([0-9]{2}(0[48]|[2468][048]|[13579][26])|([02468][048]|[13579][26])00)-02-29)'
 url_pattern=r'https?://[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?(/[a-zA-Z0-9._~!$&()*+,;=:@%/-]*)?(\?[a-zA-Z0-9._~!$&()*+,;=:@/?-]*)?(#[a-zA-Z0-9._~!$&()*+,;=:@%/?-]*)?'
 host_pattern=r'https?://[a-zA-Z0-9.-]*[a-zA-Z][a-zA-Z0-9.-]*([/?#].*)?'
 text_pattern='.*['+''.join(chr(a)+'-'+chr(b) for a,b in [(33,126),(161,5759),(5761,8191),(8203,8231),(8234,8238),(8240,8286),(8288,12287),(12289,65278),(65280,65535)])+'].*'
 at_pattern=date_pattern+r'T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z'
 policy={'date':date_pattern,'at':at_pattern,'text':text_pattern,'url':url_pattern,'host':host_pattern}
 from pathlib import Path
 Path('desktop-crm/src/rnd-control/follow-up-policy.mjs').write_text('export const followUpPolicy = Object.freeze('+json.dumps(policy,ensure_ascii=True)+');\n',encoding='utf-8')
 host_pattern=host_pattern.replace('/',r'\/')
 url_pattern=url_pattern.replace('/', r'\/')
 sensitive='|'.join(''.join('['+c.lower()+c.upper()+']' if c.isalpha() else c for c in word) for word in ['token','secret','password','authorization','credential','signature','auth','key'])
 def child(field): return "newData.child('"+field+"')"
 def val(field): return child(field)+'.val()'
 head="root.child('rndControl/projects').child($id).child('research/followUpHeads').child("+val('taskId')+")"
 previous="root.child('rndControl/projects').child($id).child('research/followUpEvents').child("+head+".child('eventId').val())"
 newhead="newData.parent().parent().child('followUpHeads').child("+val('taskId')+")"
 fields=['id','taskId','projectId','decisionId','title','ownerUid','reviewerUid','due','criteria','status','sequence','previousEventId','actorUid','actorRole','reason','at','result','resultUrl','completedBy','completedAt','selfReview','selfReviewReason']
 required=[f for f in fields if f not in ['previousEventId','result','resultUrl','completedBy','completedAt','selfReview','selfReviewReason']]
 checks=['newData.hasChildren('+json.dumps(required)+')',val('id')+' === $event',val('projectId')+' === $id',val('actorUid')+' === auth.uid',val('actorRole')+" === root.child('crmCompany/access').child(auth.uid).child('role').val()", "root.child('rndControl/projects').child($id).child('research/decisions').child("+val('decisionId')+").exists()",child('sequence')+'.isNumber() && '+val('sequence')+' % 1 === 0',newhead+".child('eventId').val() === $event",newhead+".child('sequence').val() === "+val('sequence')]
 for field in ['id','taskId','decisionId','ownerUid','reviewerUid']:
  checks.append(child(field)+'.isString() && '+val(field)+'.matches(/^[a-zA-Z0-9_-]{1,128}$/)')
 for field in ['title','criteria','reason','at']:
  checks.append(child(field)+'.isString() && '+val(field)+'.length > 0 && '+val(field)+'.length <= 4000 && '+val(field)+'.matches(/'+text_pattern+'/)')
 checks.append(child('due')+'.isString() && '+val('due')+'.matches(/^'+date_pattern+'$/)')
 checks.append(val('at')+'.matches(/^'+date_pattern+r'T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$/)')
 checks=[c.replace('\t',r'\t').replace('\r',r'\r').replace('\n',r'\n') for c in checks]
 for field in ['ownerUid','reviewerUid']:
  crm="root.child('crmCompany/access').child("+val(field)+")"
  rnd="root.child('rndAccess').child("+val(field)+")"
  checks.append(crm+".child('enabled').val() === true && "+rnd+".child('enabled').val() === true && "+rnd+".child('email').val() === "+crm+".child('email').val() && "+rnd+".child('role').val() === "+crm+".child('role').val() && ("+crm+".child('role').val() === 'admin' || "+crm+".child('role').val() === 'member')")
 absent=' && '.join('!'+child(f)+'.exists()' for f in ['previousEventId','result','resultUrl','completedBy','completedAt','selfReview','selfReviewReason'])
 first='!'+head+'.exists() && '+admin+' && '+val('sequence')+" === 1 && "+val('status')+" === 'todo' && "+absent
 fixed=' && '.join(val(f)+' === '+previous+".child('"+f+"').val()" for f in ['projectId','decisionId','title','ownerUid','reviewerUid','due','criteria'])
 transitions={'todo':['active','blocked','cancelled'],'active':['review','blocked','cancelled'],'blocked':['active','cancelled'],'review':['done','active','blocked','cancelled']}
 transition=' || '.join('('+previous+".child('status').val() === '"+old+"' && ("+' || '.join(val('status')+" === '"+new+"'" for new in targets)+'))' for old,targets in transitions.items())
 identity="("+val('status')+" === 'done' ? (auth.uid === "+val('reviewerUid')+' || '+admin+') : (auth.uid === '+val('ownerUid')+' || '+admin+'))'
 completion="("+val('status')+" === 'done' ? ("+val('completedBy')+' === auth.uid && '+val('completedAt')+' === '+val('at')+' && '+val('selfReview')+' === (auth.uid === '+val('ownerUid')+') && (auth.uid === '+val('ownerUid')+' ? ('+child('selfReviewReason')+'.isString() && '+val('selfReviewReason')+'.length > 0 && '+val('selfReviewReason')+'.length <= 4000 && '+val('selfReviewReason')+'.matches(/'+text_pattern+'/)) : !'+child('selfReviewReason')+'.exists())) : ('+' && '.join('!'+child(f)+'.exists()' for f in ['completedBy','completedAt','selfReview','selfReviewReason'])+'))'
 result="("+val('status')+" === 'review' ? ("+child('result')+'.isString() && '+val('result')+'.length <= 4000 && '+val('result')+'.matches(/'+text_pattern+'/) && '+child('resultUrl')+'.isString() && '+val('resultUrl')+'.matches(/^'+url_pattern+'$/) && '+val('resultUrl')+'.matches(/^'+host_pattern+'$/) && !'+val('resultUrl')+'.matches(/.*[?&][^=&#]*('+sensitive+')[^=&#]*(=|&|#).*/) && !'+val('resultUrl')+'.matches(/.*[?&][^=&#]*('+sensitive+')[^=&#]*$/)) : ('+val('result')+' === '+previous+".child('result').val() && "+val('resultUrl')+' === '+previous+".child('resultUrl').val()))"
 subsequent=head+'.exists() && '+previous+'.exists() && '+val('sequence')+' === '+head+".child('sequence').val() + 1 && "+val('previousEventId')+' === '+head+".child('eventId').val() && "+fixed+' && ('+transition+') && '+identity+" && ("+val('status')+" !== 'cancelled' || "+admin+') && '+completion+' && '+result
 checks.append('('+first+') || ('+subsequent+')')
 checks.append('!'+head+'.exists() || '+val('at')+' >= '+previous+".child('at').val()")
 checks=[c.replace('\t',r'\t').replace('\r',r'\r').replace('\n',r'\n') for c in checks]
 project['research']['followUpEvents']={'$event':{'.write':access+' && !data.exists() && newData.exists()', '.validate':' && '.join('('+c+')' for c in checks),'$other':{'.validate':False},**{f:{} for f in fields}}}
 event="newData.parent().parent().child('followUpEvents').child(newData.child('eventId').val())"
 oldevent="root.child('rndControl/projects').child($id).child('research/followUpEvents').child(newData.child('eventId').val())"
 headchecks=["newData.hasChildren(['eventId','sequence'])",event+'.exists()', '!'+oldevent+'.exists()',event+".child('taskId').val() === $task", event+".child('sequence').val() === newData.child('sequence').val()",event+".child('previousEventId').val() === data.child('eventId').val()", "newData.child('sequence').val() === (data.exists() ? data.child('sequence').val() + 1 : 1)"]
 project['research']['followUpHeads']={'$task':{'.write':access+' && newData.exists()', '.validate':' && '.join('('+c+')' for c in headchecks),'eventId':{},'sequence':{},'$other':{'.validate':False}}}
