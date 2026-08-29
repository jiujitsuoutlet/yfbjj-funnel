const { test, expect } = require('playwright/test');
const fs = require('fs');
const BASE='https://yfbjj-funnel-visual-staging.sebastian-brosche.workers.dev';
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const sizes=[[375,667],[375,812],[768,1024],[1024,768],[1440,900]];
test.use({ignoreHTTPSErrors:true,userAgent:UA});
const results={testedAt:new Date().toISOString(),base:BASE,cases:[],cookies:{},handoff:{},routes:{},legal:{}};
function collect(page, tag) {
  const errors=[]; const failed=[];
  page.on('console',m=>{if(m.type()==='error') errors.push(m.text())});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('requestfailed',r=>failed.push({url:r.url(),error:r.failure()?.errorText}));
  return {errors,failed};
}
for (const variant of ['a','b']) for (const [width,height] of sizes) test(`${variant}-${width}x${height}`,async({browser})=>{
  const context=await browser.newContext({viewport:{width,height},ignoreHTTPSErrors:true,userAgent:UA}); const page=await context.newPage(); const ev=collect(page);
  const responses=[]; page.on('response',r=>{if(r.status()>=400)responses.push({url:r.url(),status:r.status()})});
  await page.goto(`${BASE}/?v=${variant}&utm_source=qa&utm_medium=linear&gclid=gclid123&utm_content=incoming&evil=dropme`,{waitUntil:'networkidle'});
  const metrics=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,scrollHeight:document.documentElement.scrollHeight,clientHeight:document.documentElement.clientHeight,bodyRect:document.body.getBoundingClientRect().toJSON(),visible:[...document.querySelectorAll('body *')].filter(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width&&r.height}).length,smallText:[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width&&r.height&&parseFloat(s.fontSize)<11}).map(e=>({tag:e.tagName,text:e.textContent.trim().slice(0,40),px:getComputedStyle(e).fontSize}))}));
  const ctas=await page.locator('[data-cart]').evaluateAll(as=>as.map(a=>({text:a.textContent.trim(),href:a.href,box:a.getBoundingClientRect().toJSON()})));
  await page.screenshot({path:`evidence/exc-98/screenshots/${variant}-${width}x${height}.png`,fullPage:true});
  results.cases.push({variant,width,height,url:page.url(),title:await page.title(),metrics,ctas,consoleErrors:ev.errors,requestFailures:ev.failed,httpErrors:responses});
  await context.close();
});
test('cookies-handoff-routes-legal',async({browser,request})=>{
 const context=await browser.newContext({viewport:{width:375,height:812},ignoreHTTPSErrors:true,userAgent:UA}); const page=await context.newPage(); const ev=collect(page);
 await page.goto(BASE+'/',{waitUntil:'networkidle'}); const naturalUrl=page.url(); const assigned=(await context.cookies()).find(c=>c.name==='yfbjj_v');
 await page.reload({waitUntil:'networkidle'}); const afterReload=(await context.cookies()).find(c=>c.name==='yfbjj_v');
 const forced=assigned.value==='a'?'b':'a'; await page.goto(`${BASE}/?v=${forced}`,{waitUntil:'networkidle'}); const afterForced=(await context.cookies()).find(c=>c.name==='yfbjj_v');
 results.cookies={naturalUrl,assigned,afterReload,forced,afterForced};
 for(const variant of ['a','b']){
   await page.goto(`${BASE}/?v=${variant}&utm_source=source%20value&utm_medium=medium%2Fvalue&gclid=abc%2B123&utm_content=incoming&evil=dropme`,{waitUntil:'networkidle'});
   await page.locator('#email').fill('qa-browser-no-write@example.com'); await Promise.all([page.waitForURL(/\/preview-checkout/),page.locator('#lead-submit').click()]); const href=page.url(); const u=new URL(href);
   results.handoff[variant]={href,pathname:u.pathname,params:Object.fromEntries(u.searchParams)};
 }
 for(const route of ['/api/checkout','/api/lead']){
  const out=await page.evaluate(async ({route})=>{const r=await fetch(route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'qa-browser-no-write@example.com'})});return {status:r.status,body:await r.text()}},{route}); results.routes[route]=out;
 }
 results.routes['/api/stats']=await page.evaluate(async()=>{const r=await fetch('/api/stats');return {status:r.status,body:await r.text()}});
 results.routes['/health']=await page.evaluate(async()=>{const r=await fetch('/health');return {status:r.status,body:await r.text()}});
 for(const path of ['/?v=a','/?v=b','/thanks']){
  await page.goto(BASE+path,{waitUntil:'networkidle'}); const links=await page.locator('a[href*="/legal/"], a[href^="mailto:"]').evaluateAll(as=>as.map(a=>({text:a.textContent.trim(),href:a.href})));
  results.legal[path]=links;
 }
 for(const dest of ['https://yfbjj.autocreator.ai/legal/terms','https://yfbjj.autocreator.ai/legal/privacy']){ const resp=await page.goto(dest,{waitUntil:'domcontentloaded'}); results.legal[dest]={status:resp.status(),finalUrl:page.url(),title:await page.title(),bodyTextLength:(await page.locator('body').innerText()).trim().length}; }
 results.auxErrors={consoleErrors:ev.errors,requestFailures:ev.failed}; await context.close();
});
test.afterAll(()=>fs.writeFileSync('evidence/exc-98/browser-results.json',JSON.stringify(results,null,2)+'\n'));
