import React, {useState} from 'react';
import './web-fonts';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {CompanyScreen} from './CompanyScreen';
import {FieldWorkspace} from './FieldWorkspace';
import {previewFor} from './previews';
const Preview=previewFor(typeof window!=='undefined'&&typeof window.location?.search==='string'?window.location.search:'');
export default function App(){const[sample,setSample]=useState(false);return <SafeAreaProvider>{Preview?<Preview/>:sample?<FieldWorkspace onClose={()=>setSample(false)}/>:<CompanyScreen openSample={()=>setSample(true)}/>}</SafeAreaProvider>;}
