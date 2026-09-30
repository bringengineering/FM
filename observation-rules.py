def install_observation_rules(project,access):
 import json
 from pathlib import Path
 policy=json.loads(Path('desktop-crm/src/rnd-control/follow-up-policy.mjs').read_text(encoding='utf-8').split('Object.freeze(',1)[1].rsplit(');',1)[0])
 fields=['id','projectId','experimentId','planRevision','unitId','name','unit','status','value','reason','observedAt','recordedBy','at']
 def val(k):return "newData.child('"+k+"').val()"
 experiment="newData.parent().parent().child('experiments').child("+val('experimentId')+")"
 checks=['newData.hasChildren('+json.dumps([k for k in fields if k!='value'])+')',val('id')+' === $observation',val('projectId')+' === $id',val('recordedBy')+' === auth.uid',experiment+".child('status').val() === 'running'",val('planRevision')+' === '+experiment+".child('planVersion').val()"]
 for k in ['id','experimentId','unitId','recordedBy']:checks.append("newData.child('"+k+"').isString() && "+val(k)+'.matches(/^[a-zA-Z0-9_-]{1,128}$/)')
 for k in ['name','unit','reason']:checks.append("newData.child('"+k+"').isString() && "+val(k)+'.length <= 4000 && '+val(k)+'.matches(/'+policy['text']+'/)')
 for k in ['observedAt','at']:checks.append("newData.child('"+k+"').isString() && "+val(k)+'.matches(/^'+policy['at']+'$/)')
 checks.append(val('observedAt')+' <= '+val('at'))
 checks.append('('+val('status')+" === 'OBSERVED' && newData.child('value').isNumber()) || (("+' || '.join(val('status')+" === '"+s+"'" for s in ['MISSING','NOT_INSPECTED','UNOBSERVABLE'])+") && !newData.child('value').exists())")
 project['research']['observations']={'$observation':{'.write':access+' && newData.exists() && !data.exists()', '.validate':' && '.join('('+c+')' for c in checks),**{k:{} for k in fields},'$other':{'.validate':False}}}
