import React, {useState} from 'react';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {CompanyScreen} from './CompanyScreen';
import {FieldWorkspace} from './FieldWorkspace';
export default function App(){const[sample,setSample]=useState(false);return <SafeAreaProvider>{sample?<FieldWorkspace onClose={()=>setSample(false)}/>:<CompanyScreen openSample={()=>setSample(true)}/>}</SafeAreaProvider>;}
