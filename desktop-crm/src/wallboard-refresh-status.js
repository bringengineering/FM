'use strict';

function createWallboardRefreshStatus({now=Date.now}={}){
 let remoteRefreshAt=null,remotePublishedAt=null,remoteVersion=null,remoteRefreshError='';
 return {
  succeeded(result){
   remoteRefreshAt=now();
   remotePublishedAt=Number.isFinite(result?.publishedAt)?result.publishedAt:null;
   remoteVersion=Number.isSafeInteger(result?.version)?result.version:null;
   remoteRefreshError='';
  },
  failed(error){
   remoteRefreshAt=now();
   remoteRefreshError=['AUTH_REQUIRED','FORBIDDEN','RATE_LIMITED'].includes(error?.code)?error.code:'REMOTE_REFRESH_FAILED';
  },
  reset(){remoteRefreshAt=null;remotePublishedAt=null;remoteVersion=null;remoteRefreshError='';},
  status(){return {remoteRefreshAt,remotePublishedAt,remoteVersion,remoteRefreshError};}
 };
}

module.exports={createWallboardRefreshStatus};
