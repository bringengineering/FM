// Separate preview installer. Never publish to the CRM update feed.
module.exports={
 extends:null,
 appId:'kr.co.bringengineering.wallboard',productName:'BRING TV',
 extraMetadata:{name:'bring-tv',version:'0.1.0',main:'src/wallboard-tv-main.js',description:'BRING 회사 운영보드 읽기 전용 TV'},
 artifactName:'BRING.TV.Preview.Setup.${version}.${ext}',
 asar:true,directories:{output:'dist-tv'},
 files:['package.json','src/wallboard-tv-main.js','src/wallboard-tv-preload.js','src/wallboard-tv-client.js','src/wallboard-tv-renderer.js','src/wallboard-tv.html','src/wallboard-tv.css','src/wallboard-publication-schema.js','src/company-wallboard.js','src/company-wallboard.css','src/company-wallboard-theme.css','src/styles.css','src/toss.css','src/assets/bring-logo.png'],
 win:{icon:'src/assets/bring-logo.png',target:[{target:'nsis',arch:['x64']}]},
 nsis:{oneClick:false,perMachine:false,allowElevation:false,allowToChangeInstallationDirectory:true,createDesktopShortcut:'always',createStartMenuShortcut:true,shortcutName:'BRING TV',deleteAppDataOnUninstall:false,runAfterFinish:false},
 publish:null
};
