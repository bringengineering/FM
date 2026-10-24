import * as T from 'three';
export function equipmentShape(record,color){
 const group=new T.Group();
 function part(geo,x,y,z,c=color,rotation=0){const m=new T.Mesh(geo,new T.MeshStandardMaterial({color:c,metalness:.22,roughness:.42}));m.position.set(x,y,z);m.rotation.z=rotation;group.add(m);return m;}
 const box=(w,h,d,x,y,z,c)=>part(new T.BoxGeometry(w,h,d),x,y,z,c);
 const cylinder=(r,h,x,y,z,c,rotation=0)=>part(new T.CylinderGeometry(r,r,h,24),x,y,z,c,rotation);
 switch(record.shape){
 case 'pump':
 box(2.2,.18,1.2,0,-.65,0,0x47576a);cylinder(.43,1.35,0,0,0,color,Math.PI/2);cylinder(.54,.48,-.8,0,0,0x6c92a9,Math.PI/2);cylinder(.17,.6,-.8,.5,0,0xcedbe7);box(.65,.25,.65,.35,.4,0,0x24364b);break;
 case 'tank':box(2.8,1.8,2.3,0,.1,0,color);for(let x=-1;x<=1;x++)box(.035,1.84,2.34,x,.1,0,0x9bd8f3);box(3,.15,2.5,0,1.06,0,0x577d9a);cylinder(.2,.5,1,1.3,0,0xaed8eb);break;
 case 'valve':cylinder(.14,1,0,0,0,0xb7cbda,Math.PI/2);cylinder(.25,.4,0,0,0,color,Math.PI/2);cylinder(.05,.5,0,.4,0,0xb7cbda);{const wheel=part(new T.TorusGeometry(.33,.05,10,24),0,.7,0,0xef7656);wheel.rotation.x=Math.PI/2;}break;
 case 'cabinet':box(.9,1.5,.4,0,0,0,0xc1d0de);box(.72,1.3,.045,0,0,.23,color);box(.08,.22,.08,.24,0,.27,0x263b51);box(.4,.2,.05,0,.35,.27,0x152c43);break;
 case 'extinguisher':cylinder(.2,.9,0,0,0,0xea4a56);cylinder(.09,.2,0,.54,0,0x192f48);box(.38,.05,.08,0,.7,0,0x263b51);break;
 case 'ac':box(1.7,1.05,.7,0,0,0,0xc3d5e2);for(const x of [-.42,.42]){const fan=cylinder(.32,.04,x,0,.38,0x334d66);fan.rotation.x=Math.PI/2;}break;
 case 'drain':box(.85,.2,.85,0,-.4,0,0x5c7188);for(let i=-3;i<=3;i++)box(.055,.04,.75,i*.1,-.27,0,0x1c3045);break;
 default:return null;
 }
 group.traverse(o=>{if(o.isMesh)o.userData.id=record.id;});return group;
}
