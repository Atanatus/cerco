const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const assert=require('node:assert/strict');

process.env.PLAYWRIGHT_BROWSERS_PATH ||=
  path.resolve('.local-recovery/browsers');

const {chromium}=require('playwright');

async function main(){
  const writes=[];
  const pageErrors=[];
  let failApi=false;

  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://127.0.0.1').pathname;

    let file;
    if(['/status','/status/','/status/index.html'].includes(pathname)){
      file='status/index.html';
    }else if(pathname==='/index.html'){
      file='index.html';
    }else if(pathname==='/src/js/public-chat.js'){
      file='src/js/public-chat.js';
    }else if(pathname==='/games/CERCO/cerco_expedition_v090.html'){
      file='games/CERCO/cerco_expedition_v090.html';
    }else if(pathname==='/games/CERCO/cerco_expedition_v091_beta.html'){
      file='games/CERCO/cerco_expedition_v091_beta.html';
    }else if(pathname==='/assets/profile-pictures/Profile_Picture1.png'){
      file='assets/profile-pictures/Profile_Picture1.png';
    }else{
      res.writeHead(404);
      res.end();
      return;
    }

    const type=file.endsWith('.png')?'image/png':
      file.endsWith('.js')?'text/javascript':'text/html; charset=utf-8';

    res.writeHead(200,{
      'Content-Type':type,
      'Cache-Control':'no-store'
    });

    if(req.method==='HEAD'){
      res.end();
      return;
    }

    res.end(fs.readFileSync(path.resolve(file)));
  });

  let browser;

  try{
    await new Promise((resolve,reject)=>{
      server.once('error',reject);
      server.listen(0,'127.0.0.1',resolve);
    });

    const base='http://127.0.0.1:'+server.address().port;

    browser=await chromium.launch({headless:true,chromiumSandbox:true});

    const page=await browser.newPage({
      viewport:{width:1100,height:800}
    });

    page.on('pageerror',error=>pageErrors.push(error.message));

    // Deterministic WebSocket: no real production connections.
    await page.addInitScript(()=>{
      window.WebSocket=class{
        static OPEN=1;
        constructor(url){
          window.__statusSocketUrl=url;
          this.readyState=0;

          setTimeout(()=>{
            if(localStorage.getItem('op65WsFail')==='yes'){
              if(this.onerror)this.onerror(new Event('error'));
            }else{
              this.readyState=1;
              if(this.onopen)this.onopen(new Event('open'));
            }
          },20);
        }
        close(){
          this.readyState=3;
          if(this.onclose)this.onclose(new Event('close'));
        }
      };
    });

    await page.route('**/*',async route=>{
      const req=route.request();
      const url=req.url();

      if(url.startsWith(base+'/')){
        if(!['GET','HEAD'].includes(req.method()))writes.push(url);
        return route.continue();
      }

      if(!url.startsWith('https://cerco-api.atanatus.workers.dev/')){
        return route.abort();
      }

      if(req.method()!=='GET')writes.push(url);

      const endpoint=new URL(url).pathname;
      let status=200;
      let data={};

      if(failApi){
        status=503;
        data={error:'unavailable'};
      }else if(endpoint==='/health'){
        data={service:'cerco-api',status:'ok'};
      }else if(endpoint==='/chat/status'){
        data={available:true,paused:false};
      }else if(endpoint==='/chat/moderation'){
        status=403;
        data={error:'forbidden'};
      }else if(endpoint==='/leaderboards'){
        data={
          leaderboard:'guest',
          metric:'score',
          ruleset:'CERCO-0.9.0',
          entries:[]
        };
      }else{
        status=404;
        data={error:'not_found'};
      }

      return route.fulfill({
        status,
        headers:{
          'Content-Type':'application/json',
          'Access-Control-Allow-Origin':base,
          'Cache-Control':'no-store'
        },
        body:JSON.stringify(data)
      });
    });

    await page.goto(base+'/status');

    await page.waitForFunction(
      ()=>document.querySelectorAll(
        '[data-service][data-state="checking"]'
      ).length===0
    );

    const initial=await page.locator('[data-service]')
      .evaluateAll(rows=>rows.map(el=>el.dataset.state));

    assert.equal(initial.length,10);
    assert(initial.every(state=>state==='up'));

    assert.equal(
      await page.evaluate(()=>window.__statusSocketUrl),
      'wss://cerco-api.atanatus.workers.dev/chat/socket'
    );

    await page.screenshot({
      path:path.resolve('.local-recovery/op65-status.png'),
      fullPage:true
    });

    // Failure scenario: all API-backed checks must turn red.
    failApi=true;

    await page.locator('#refresh').click();

    await page.waitForFunction(
      ()=>!document.getElementById('refresh').disabled
    );

    for(const id of ['api','chat','ws','moderation','rankings']){
      assert.equal(
        await page.locator('[data-service="'+id+'"]')
          .getAttribute('data-state'),
        'down',
        id+' failure state'
      );
    }

    assert.equal(
      await page.locator('[data-service="web"]')
        .getAttribute('data-state'),
      'up'
    );

    // WebSocket-only failure must be reported separately.
    failApi=false;

    await page.evaluate(()=>{
      localStorage.setItem('op65WsFail','yes');
    });

    await page.locator('#refresh').click();

    await page.waitForFunction(
      ()=>!document.getElementById('refresh').disabled
    );

    assert.equal(
      await page.locator('[data-service="chat"]')
        .getAttribute('data-state'),
      'up'
    );

    assert.equal(
      await page.locator('[data-service="ws"]')
        .getAttribute('data-state'),
      'down'
    );

    assert.deepEqual(writes,[]);
    assert.deepEqual(pageErrors,[]);

    console.log('PASS OP65: /status resolves and ten checks turn green.');
    console.log('PASS OP65: API failure produces red indicators.');
    console.log('PASS OP65: independent WebSocket failure is detected.');
    console.log('PASS OP65: no production writes or browser exceptions.');
  }finally{
    if(browser)await browser.close();
    if(server.listening){
      await new Promise(resolve=>server.close(resolve));
    }
  }
}

main().catch(error=>{
  console.error(error);
  process.exitCode=1;
});
