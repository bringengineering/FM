// Local-only fixture preview of the REAL CRM index/app; never loads Electron main or production credentials.
const http=require('node:http');const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'../src');
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 let file=url.pathname==='/preview-fixture.js'?path.join(__dirname,'operations-check-preview-fixture.js'):path.resolve(root,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));
 if(file!==path.join(__dirname,'operations-check-preview-fixture.js')&&!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
 if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
 const types={'.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
 res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
 res.setHeader('Content-Security-Policy',"default-src 'self' data:; connect-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src 'none'; object-src 'none'; form-action 'none'");
 res.setHeader('Cache-Control','no-store');
 let body=fs.readFileSync(file);if(path.basename(file)==='index.html')body=body.toString().replace('<script src="./app.js"></script>','<script src="/preview-fixture.js"></script><script src="./app.js"></script>');
 res.end(body);
});server.listen(0,'127.0.0.1',()=>console.log(`Preview http://127.0.0.1:${server.address().port}/?view=dashboard`));
