import React, {useState} from 'react';
import './web-fonts';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {CompanyScreen} from './CompanyScreen';
import {FieldWorkspace} from './FieldWorkspace';
import {FlowPrototype} from './prototype/FlowPrototype';
// 맥 브라우저 미리보기에서 주소 끝에 ?proto 를 붙이면 새 흐름 시안을 연다.
const proto=typeof window!=='undefined'&&typeof window.location?.search==='string'&&window.location.search.includes('proto');
export default function App(){const[sample,setSample]=useState(false);return <SafeAreaProvider>{proto?<FlowPrototype/>:sample?<FieldWorkspace onClose={()=>setSample(false)}/>:<CompanyScreen openSample={()=>setSample(true)}/>}</SafeAreaProvider>;}
