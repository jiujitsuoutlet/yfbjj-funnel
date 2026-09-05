// Local visual fixture only. Never publishes or changes stored page documents.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { defaultDocument } from '../src/editor/defaults.js';
import { renderContentDocument } from '../src/editor/renderer.js';
const doc = defaultDocument('offer-certification');
doc.sections[0].preset = 'none';
delete doc.sections[0].style;
const elements = doc.sections[0].rows[0].columns[0].elements;
elements.find(e => e.type === 'heading').content = 'Teach yoga to the people you train with';
elements.find(e => e.type === 'text').content = 'If you coach BJJ, you already spend time helping people understand how to move. These courses let you study the yoga side of that work. For our 14 year anniversary, you can get all three instructor-course levels for $297.';
elements.splice(1,0,{id:'brand-photo',type:'image',src:`data:image/webp;base64,${readFileSync('public/img/coaching-1600.webp').toString('base64')}`,alt:'Sebastian teaching grapplers.'});
elements.splice(4,0,{id:'brand-heading',type:'heading',level:2,content:'Learn to put a class together'});
const css = readFileSync('src/pages/_base.css','utf8') + readFileSync('src/pages/_brand.css','utf8');
const rendered = renderContentDocument(doc,{pageKey:'offer-certification'});
mkdirSync('artifacts/brand-preview',{recursive:true});
writeFileSync('artifacts/brand-preview/index.html',`<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local brand preview</title><style>${css}</style><body>${rendered.body}</body></html>`);
