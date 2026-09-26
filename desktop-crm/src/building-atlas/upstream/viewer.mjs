import * as T from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {colors,connected} from './model.mjs';
import {routePoints} from './portfolio.mjs';
import {equipmentShape} from './equipment-shapes.mjs';
export function createViewer(host,onSelect){
 const scene=new T.Scene();scene.background=new T.Color(0x101e30);
 const camera=new T.PerspectiveCamera(42,1,.1,500);const renderer=new T.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));host.append(renderer.domElement);
 const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.maxDistance=110;controls.minDistance=8;
 scene.add(new T.HemisphereLight(0xcfe6ff,0x44526a,3));const light=new T.DirectionalLight(0xffffff,3);light.position.set(15,30,20);scene.add(light);
 const grid=new T.GridHelper(60,30,0x3c5473,0x22364c);grid.position.y=-.3;scene.add(grid);
 let root=new T.Group();scene.add(root);let pickables=[],data,state;
 function label(text,x,y,z){const c=document.createElement('canvas');c.width=384;c.height=80;const ctx=c.getContext('2d');ctx.fillStyle='#16304ce6';ctx.fillRect(0,0,384,80);ctx.fillStyle='#e3efff';ctx.font='28px sans-serif';ctx.textAlign='center';ctx.fillText(text,192,51);const texture=new T.CanvasTexture(c);const sprite=new T.Sprite(new T.SpriteMaterial({map:texture,depthTest:false}));sprite.position.set(x,y,z);sprite.scale.set(5,1.05,1);root.add(sprite);}
 function box(w,h,d,x,y,z,color,opacity=1){const mesh=new T.Mesh(new T.BoxGeometry(w,h,d),new T.MeshStandardMaterial({color,transparent:opacity<1,opacity,roughness:.5,depthWrite:opacity>=1}));mesh.position.set(x,y,z);root.add(mesh);return mesh;}
 function point(r){return new T.Vector3(r.x,r.floor*(state.explode?5.5:3.4)+1,r.z);}
 function update(next,options){data=next;state=options;root.traverse(o=>{o.geometry?.dispose();if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material]){m.map?.dispose();m.dispose();}});scene.remove(root);root=new T.Group();scene.add(root);pickables=[];
 const b=data.building,step=state.explode?5.5:3.4;
 for(let f=0;f<=b.floors;f++){
 if(state.floor!=='all'&&f!==Number(state.floor))continue;
 box(b.width,.14,b.depth,0,f*step,0,0x7293b8,.45);
 label(f===0?'B1':f+'F',-b.width/2-2,f*step+.4,b.depth/2);
 if(b.example){
 for(const x of [-2,2])box(.12,2.7,b.depth-.6,x,f*step+1.4,0,0x849db4,state.transparent?.12:.8);
 if(f>0){box(b.width,.1,2.3,0,f*step+.15,0,0x9bb3c8,.6);for(const x of [-5.3,5.3])box(6.5,2.7,.1,x,f*step+1.4,0,0x829bb3,state.transparent?.12:.8);}
 if(f<b.floors){for(let s=0;s<12;s++)box(1.4,.12,.3,-.5,f*step+.25+s*.26,-2+s*.3,0xc0ccd7,state.transparent?.55:1);}
 }
 if(!state.transparent){box(b.width,2.9,.14,0,f*step+1.5,-b.depth/2,0x9fb5c9,.7);box(.14,2.9,b.depth,-b.width/2,f*step+1.5,0,0x9fb5c9,.7);}else{
 const outline=new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(b.width,3,b.depth)),new T.LineBasicMaterial({color:0x52718e,transparent:true,opacity:.28}));outline.position.y=f*step+1.5;root.add(outline);}
 }
 const related=new Set(connected(data,state.selected));
 const visible=r=>state.layers.has(r.category)&&(state.floor==='all'||r.floor===Number(state.floor))&&(!state.isolate||related.has(r.id));
 for(const r of data.records){if(!visible(r))continue;const p=point(r),selected=r.id===state.selected;const color=selected?0xffffff:colors[r.category];let m;
 const shape=equipmentShape(r,color);
 if(shape){m=shape;m.position.copy(p);root.add(m);}
 else if(r.room){m=box(r.room.width,.08,r.room.depth,p.x,p.y-.85,p.z,color,selected?.6:.22);if(state.floor!=='all')label(r.name,p.x,p.y-.5,p.z);}
 else if(r.id.includes('tank')||r.name.includes('저수조'))m=box(2.5,1.5,2,p.x,p.y,p.z,color,.85);
 else if(r.name.includes('펌프')){m=new T.Mesh(new T.CylinderGeometry(.5,.5,1.5,24),new T.MeshStandardMaterial({color,metalness:.35,roughness:.3}));m.rotation.z=Math.PI/2;m.position.copy(p);root.add(m);box(1.8,.2,1,p.x,p.y-.65,p.z,0x536579);}
 else{m=new T.Mesh(r.category==='water'?new T.SphereGeometry(.35,20,12):new T.BoxGeometry(.9,1.1,.6),new T.MeshStandardMaterial({color,emissive:selected?0x367cdc:0x000000,emissiveIntensity:.4}));m.position.copy(p);root.add(m);}
 m.userData.id=r.id;pickables.push(m);if(selected)label(r.name,p.x,p.y+1.8,p.z);
 if(selected){const ring=new T.Mesh(new T.TorusGeometry(1,.045,8,48),new T.MeshBasicMaterial({color:0x75cfff}));ring.position.copy(p);ring.rotation.x=Math.PI/2;root.add(ring);}
 for(const id of r.links){const source=data.records.find(v=>v.id===id);if(!source||!visible(source))continue;const a=point(source),b=point(r),waypoints=routePoints(r,id);const points=waypoints.length?[a,...waypoints.map(point),b]:[a,new T.Vector3(b.x,a.y,a.z),new T.Vector3(b.x,b.y,a.z),b];const verified=waypoints.length&&(r.routes||[]).find(route=>route.targetId===id)?.confirmed===true&&r.confidence==='현장 확인'&&source.confidence==='현장 확인';const line=new T.Line(new T.BufferGeometry().setFromPoints(points),verified?new T.LineBasicMaterial({color:colors[r.category]}):new T.LineDashedMaterial({color:colors[r.category],dashSize:.4,gapSize:.22}));line.computeLineDistances();root.add(line);if(verified){for(let i=1;i<points.length;i++){const delta=points[i].clone().sub(points[i-1]),length=delta.length();if(length<.001)continue;const pipe=new T.Mesh(new T.CylinderGeometry(.08,.08,length,10),new T.MeshStandardMaterial({color:colors[r.category],metalness:.2,roughness:.4}));pipe.position.copy(points[i-1]).addScaledVector(delta,.5);pipe.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize());root.add(pipe);}}}
 }
 }
 function reset(){const step=state?.explode?5.5:3.4,height=(data?.building.floors||4)*step,single=state&&state.floor!=='all',targetY=single?Number(state.floor)*step+1:height/2;const size=Math.max(single?3:height,data?.building.width||16,data?.building.depth||12),distance=size*(single?1.05:1.45);camera.position.set(distance,targetY+distance*.85,distance);controls.maxDistance=Math.max(110,distance*4);controls.target.set(0,targetY,0);controls.update();}
 const ray=new T.Raycaster(),mouse=new T.Vector2();let down;
 renderer.domElement.addEventListener('pointerdown',e=>down=[e.clientX,e.clientY]);renderer.domElement.addEventListener('pointerup',e=>{if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;const r=renderer.domElement.getBoundingClientRect();mouse.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);ray.setFromCamera(mouse,camera);const hit=ray.intersectObjects(pickables,true)[0];if(hit)onSelect(hit.object.userData.id);});
 new ResizeObserver(()=>{const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();}).observe(host);
 function focus(id){const r=data.records.find(x=>x.id===id);if(!r)return;const p=point(r);controls.target.copy(p);camera.position.copy(p).add(new T.Vector3(7,5,8));controls.update();}
 renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});reset();return {update,reset,focus};
}
