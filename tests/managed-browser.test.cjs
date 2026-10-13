'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createPreviewServer}=require('../server.js');
test('other browsers cannot report applying managed-window insets',async()=>{
 let applied=0;
 const server=createPreviewServer({managedBrowserToken:'local-test-marker',setSafeAreaInsets:async()=>{applied++}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 try {
 const input={method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({top:45,right:0,bottom:34,left:0})};
 const ordinary=await fetch(origin+'/__api/safe-area',input);
 assert.equal(ordinary.status,503);assert.equal(applied,0);
 assert.match((await ordinary.json()).error,/separate Pocket Stage Chromium window/);
 const managed=await fetch(origin+'/__api/safe-area',{...input,headers:{...input.headers,'x-pocket-stage-managed':'local-test-marker'}});
 assert.equal(managed.status,200);assert.equal(applied,1);
 }finally{await new Promise(resolve=>server.close(resolve))}
});
