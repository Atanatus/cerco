const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
class Element {
  constructor(){this.children=[];this.dataset={};this.events={};this.hidden=false;this.text='';}
  set textContent(text){this.text=String(text);this.children=[];}
  get textContent(){return this.text+this.children.map(c=>c.textContent).join('');}
  appendChild(el){this.children.push(el);return el;}
  replaceChildren(...children){this.children=children;this.text='';}
  addEventListener(name,fn){this.events[name]=fn;}
  click(){this.events.click?.();}
}
function app({honorAbort=true}={}){
  const elements=new Map(), timers=new Map(), calls=[];
  const el=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const universal=new Element(),personal=new Element();
  universal.dataset.lbMode='universal';personal.dataset.lbMode='personal';
  el('pz-leaderboards').querySelectorAll=()=>[universal,personal];
  let timerId=0;
  vm.runInNewContext(fs.readFileSync('src/js/leaderboards.js','utf8'),{
    document:{getElementById:el,querySelector:()=>el('nav'),createElement:()=>new Element()},
    AbortController, setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),
    fetch:(url,options)=>new Promise((resolve,reject)=>{
      const call={url,options,resolve:data=>resolve({ok:true,json:async()=>data}),fail:()=>resolve({ok:false}),reject};calls.push(call);
      if(honorAbort)options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));
    })
  });
  el('nav').click();
  return {el,universal,personal,calls,timers,first:()=>el('pz-lb-column-a').children[0].textContent,
    state:()=>el('pz-leaderboards').dataset.rankingState};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const data=entries=>({leaderboard:'guest',metric:'score',ruleset:'CERCO-0.9.0',entries});
test('universal: loading is neutral; only a confirmed empty response offers the throne',async()=>{
  const a=app();a.universal.click();
  assert.equal(a.first(),'CHECKING…');assert.equal(a.state(),'loading');
  a.calls[0].resolve(data([]));await flush();
  assert.equal(a.first(),'CLAIM THE THRONE');assert.equal(a.state(),'empty');
  const rest=[...a.el('pz-lb-column-a').children,...a.el('pz-lb-column-b').children].slice(1);
  assert.equal(rest.length,29);assert.ok(rest.every(r=>r.textContent==='—'));
  a.el('pz-lb-back').click();a.personal.click();
  assert.equal(a.first(),'—');assert.equal(a.state(),'personal');assert.equal(a.calls.length,1);
});
test('universal: an API champion is rendered as safe text with its result',async()=>{
  const a=app();a.universal.click();
  a.calls[0].resolve(data([{display_name:'Guest <img onerror=bad>',best_value:1234}]));await flush();
  assert.equal(a.first(),'Guest <img onerror=bad> · 1,234');assert.equal(a.state(),'ready');
  assert.equal(a.el('pz-lb-column-a').children[0].children.length,1);
  assert.equal(a.el('pz-lb-top1').textContent,'Guest <img onerror=bad>');
});
test('HTTP failure, timeout and invalid responses leave results unknown, never vacant',async()=>{
  for(const failure of ['http','timeout','invalid','bad-entry']){
    const a=app();a.universal.click();
    if(failure==='http')a.calls[0].fail();
    else if(failure==='timeout')[...a.timers.values()][0]();
    else a.calls[0].resolve(failure==='invalid'?{entries:[]}:data([{display_name:'Guest',best_value:'9000'}]));
    await flush();assert.equal(a.state(),'unavailable',failure);assert.equal(a.first(),'UNKNOWN');
    assert.match(a.el('pz-lb-status').textContent,/RESULTS UNKNOWN/);
  }
});
test('switching modes aborts old requests; a delayed response cannot replace a newer result',async()=>{
  const a=app({honorAbort:false});a.universal.click();a.el('pz-lb-back').click();a.personal.click();
  a.calls[0].resolve(data([]));await flush();assert.equal(a.state(),'personal');assert.equal(a.first(),'—');
  a.el('pz-lb-back').click();a.universal.click();const older=a.calls[1];
  a.el('pz-lb-back').click();a.universal.click();
  a.calls[2].resolve(data([{display_name:'Guest 12345678',best_value:42}]));await flush();
  older.resolve(data([]));await flush();
  assert.equal(a.first(),'Guest 12345678 · 42');assert.equal(a.state(),'ready');assert.equal(older.options.signal.aborted,true);
});
