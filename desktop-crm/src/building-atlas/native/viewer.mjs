import * as T from '../upstream/vendor/three.module.js';
import {OrbitControls} from './OrbitControls.mjs';
import {colors,connected} from '../upstream/model.mjs';
import {routePoints} from '../upstream/portfolio.mjs';
import {equipmentShape} from './equipment-shapes.mjs';
import {palette,equipmentStyle,routeStyle} from './visual-style.mjs';
export function createViewer(host,onSelect){
 const document=host.ownerDocument,abort=new AbortController();let disposed=false;
 const release=object=>object.traverse(o=>{o.geometry?.dispose();for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[]){for(const value of Object.values(m))if(value?.isTexture)value.dispose();m.dispose();}});
 const scene=new T.Scene();scene.background=new T.Color(palette.background);
 const camera=new T.PerspectiveCamera(42,1,.1,500);const renderer=new T.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio||1,2));host.append(renderer.domElement);
 const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.maxDistance=110;controls.minDistance=8;
 scene.add(new T.HemisphereLight(0xffffff,0xc1cbd4,2));const light=new T.DirectionalLight(0xfffaf0,2.2);light.position.set(15,30,20);scene.add(light);
 const grid=new T.GridHelper(60,30,palette.grid,palette.grid);grid.position.y=-.3;scene.add(grid);
 let root=new T.Group();scene.add(root);let pickables=[],data,state;
 function label(text,x,y,z){const c=document.createElement('canvas');c.width=384;c.height=80;const ctx=c.getContext('2d');ctx.fillStyle='#fffffff2';ctx.fillRect(0,0,384,80);ctx.strokeStyle='#a6bbc8';ctx.lineWidth=3;ctx.strokeRect(1.5,1.5,381,77);ctx.fillStyle='#203a50';ctx.font='28px sans-serif';ctx.textAlign='center';ctx.fillText(text,192,51,364);const texture=new T.CanvasTexture(c);texture.colorSpace=T.SRGBColorSpace;const sprite=new T.Sprite(new T.SpriteMaterial({map:texture,depthTest:false,depthWrite:false}));sprite.position.set(x,y,z);sprite.scale.set(5,1.05,1);sprite.renderOrder=10;root.add(sprite);}
 // Decorative ground contact only, not a simulated sunlight/shadow analysis.
 function groundShadow(width,depth){const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d'),gradient=ctx.createRadialGradient(64,64,12,64,64,64);gradient.addColorStop(0,'rgba(68,89,108,.2)');gradient.addColorStop(1,'rgba(68,89,108,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);const texture=new T.CanvasTexture(c);const shadow=new T.Mesh(new T.PlaneGeometry(width*1.6,depth*1.6),new T.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=-.25;root.add(shadow);}
 function box(w,h,d,x,y,z,color,opacity=1){const mesh=new T.Mesh(new T.BoxGeometry(w,h,d),new T.MeshStandardMaterial({color,transparent:opacity<1,opacity,roughness:.5,depthWrite:opacity>=1}));mesh.position.set(x,y,z);root.add(mesh);return mesh;}
 function point(r){return new T.Vector3(r.x,r.floor*(state.explode?5.5:3.4)+1,r.z);}
 function update(next,options){if(disposed)return;data=next;state=options;release(root);scene.remove(root);root=new T.Group();scene.add(root);pickables=[];
 const b=data.building,step=state.explode?5.5:3.4;
 groundShadow(b.width,b.depth);
 for(let f=0;f<=b.floors;f++){
 if(state.floor!=='all'&&f!==Number(state.floor))continue;
 const slab=box(b.width,.14,b.depth,0,f*step,0,palette.slab,.94);
 const slabEdges=new T.LineSegments(new T.EdgesGeometry(slab.geometry),new T.LineBasicMaterial({color:palette.outline}));slabEdges.position.copy(slab.position);root.add(slabEdges);
 label(f===0?'B1':f+'F',-b.width/2-2,f*step+.4,b.depth/2);
 if(b.example){
 for(const x of [-2,2])box(.12,2.7,b.depth-.6,x,f*step+1.4,0,0x849db4,state.transparent?.12:.8);
 if(f>0){box(b.width,.1,2.3,0,f*step+.15,0,0x9bb3c8,.6);for(const x of [-5.3,5.3])box(6.5,2.7,.1,x,f*step+1.4,0,0x829bb3,state.transparent?.12:.8);}
 if(f<b.floors){for(let s=0;s<12;s++)box(1.4,.12,.3,-.5,f*step+.25+s*.26,-2+s*.3,0xc0ccd7,state.transparent?.55:1);}
 }
 if(!state.transparent){box(b.width,2.9,.14,0,f*step+1.5,-b.depth/2,palette.exterior,.55);box(.14,2.9,b.depth,-b.width/2,f*step+1.5,0,palette.exterior,.55);}else{
 const outlineBox=new T.BoxGeometry(b.width,3,b.depth),outlineEdges=new T.EdgesGeometry(outlineBox);outlineBox.dispose();const outline=new T.LineSegments(outlineEdges,new T.LineBasicMaterial({color:palette.outline,transparent:true,opacity:.4}));outline.position.y=f*step+1.5;root.add(outline);}
 }
 const related=new Set(connected(data,state.selected));
 const visible=r=>state.layers.has(r.category)&&(state.floor==='all'||r.floor===Number(state.floor))&&(!state.isolate||related.has(r.id));
 for(const r of data.records){if(!visible(r))continue;const p=point(r),selected=r.id===state.selected,style=equipmentStyle(colors[r.category],selected);const color=style.color;let m;
 const shape=equipmentShape(r,color);
 if(shape){m=shape;m.position.copy(p);root.add(m);}
 else if(r.room){m=box(r.room.width,.08,r.room.depth,p.x,p.y-.85,p.z,color,selected?.6:.22);if(state.floor!=='all')label(r.name,p.x,p.y-.5,p.z);}
 else if(r.id.includes('tank')||r.name.includes('저수조'))m=box(2.5,1.5,2,p.x,p.y,p.z,color,.85);
 else if(r.name.includes('펌프')){m=new T.Mesh(new T.CylinderGeometry(.5,.5,1.5,24),new T.MeshStandardMaterial({color,metalness:.35,roughness:.3}));m.rotation.z=Math.PI/2;m.position.copy(p);root.add(m);box(1.8,.2,1,p.x,p.y-.65,p.z,0x536579);}
 else{m=new T.Mesh(r.category==='water'?new T.SphereGeometry(.35,20,12):new T.BoxGeometry(.9,1.1,.6),new T.MeshStandardMaterial({color}));m.position.copy(p);root.add(m);}
 m.userData.id=r.id;pickables.push(m);if(selected)label(r.name,p.x,p.y+1.8,p.z);
 if(selected){const ring=new T.Mesh(new T.TorusGeometry(1,.065,8,48),new T.MeshBasicMaterial({color:style.ringColor,depthTest:false,depthWrite:false}));ring.position.copy(p);ring.rotation.x=Math.PI/2;ring.renderOrder=9;root.add(ring);}
 for(const id of r.links){const source=data.records.find(v=>v.id===id);if(!source||!visible(source))continue;const a=point(source),b=point(r),waypoints=routePoints(r,id);const points=waypoints.length?[a,...waypoints.map(point),b]:[a,new T.Vector3(b.x,a.y,a.z),new T.Vector3(b.x,b.y,a.z),b];const verified=waypoints.length&&(r.routes||[]).find(route=>route.targetId===id)?.confirmed===true&&r.confidence==='현장 확인'&&source.confidence==='현장 확인';const route=routeStyle(r.id,id,state.selected,Boolean(verified)),material={color:colors[r.category],transparent:true,opacity:route.opacity,depthWrite:false};const line=new T.Line(new T.BufferGeometry().setFromPoints(points),verified?new T.LineBasicMaterial(material):new T.LineDashedMaterial({...material,dashSize:.4,gapSize:.22}));line.computeLineDistances();root.add(line);if(verified){for(let i=1;i<points.length;i++){const delta=points[i].clone().sub(points[i-1]),length=delta.length();if(length<.001)continue;const pipe=new T.Mesh(new T.CylinderGeometry(.08,.08,length,10),new T.MeshStandardMaterial({...material,metalness:.2,roughness:.4}));pipe.position.copy(points[i-1]).addScaledVector(delta,.5);pipe.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize());root.add(pipe);}}}
 }
 }
 function reset(){if(disposed)return;const step=state?.explode?5.5:3.4,height=(data?.building.floors||4)*step,single=state&&state.floor!=='all',targetY=single?Number(state.floor)*step+1:height/2;const size=Math.max(single?3:height,data?.building.width||16,data?.building.depth||12),distance=size*(single?1.05:1.45);camera.position.set(distance,targetY+distance*.85,distance);controls.maxDistance=Math.max(110,distance*4);controls.target.set(0,targetY,0);controls.update();}
 const ray=new T.Raycaster(),mouse=new T.Vector2();let down;
 renderer.domElement.addEventListener('pointerdown',e=>down=[e.clientX,e.clientY],{signal:abort.signal});renderer.domElement.addEventListener('pointerup',e=>{if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;const r=renderer.domElement.getBoundingClientRect();if(r.width<=0||r.height<=0)return;mouse.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);ray.setFromCamera(mouse,camera);const hit=ray.intersectObjects(pickables,true)[0];if(hit){let object=hit.object;while(object&&!object.userData.id)object=object.parent;if(object)onSelect(object.userData.id);}},{signal:abort.signal});
 const observer=new ResizeObserver(()=>{const w=host.clientWidth,h=host.clientHeight;if(disposed||w<=0||h<=0)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();});observer.observe(host);
 function focus(id){if(disposed)return;const r=data.records.find(x=>x.id===id);if(!r)return;const p=point(r);controls.target.copy(p);camera.position.copy(p).add(new T.Vector3(7,5,8));controls.update();}
 renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});reset();function dispose(){if(disposed)return;disposed=true;abort.abort();renderer.setAnimationLoop(null);observer.disconnect();controls.dispose();release(scene);scene.clear();pickables=[];renderer.dispose();renderer.forceContextLoss?.();renderer.domElement.remove();}return {update,reset,focus,dispose};
}
