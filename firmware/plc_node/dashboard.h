// dashboard.h — the page the power node serves. Plain HTML/CSS/JS in PROGMEM,
// no CDN, because the demo may well run on an access point with no internet.

#pragma once
#include <Arduino.h>

static const char DASHBOARD_HTML[] PROGMEM = R"HTML(<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Power Bus</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--fg:#14171a;--mut:#6b7280;--line:#e3e6ea;
      --ok:#107f4e;--off:#b4253d;--accent:#2f6feb;--warn:#9a6700}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){
      --bg:#0f1115;--card:#171a21;--fg:#e8eaed;--mut:#9aa3af;--line:#262b34;
      --ok:#3fcf8e;--off:#ff6b81;--accent:#6ea8fe;--warn:#e3b341}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:920px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:20px;margin:0 0 2px;letter-spacing:-.01em}
.sub{color:var(--mut);font-size:13px;margin-bottom:20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:14px}
.row{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.big{font-size:28px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.mut{color:var(--mut);font-size:13px}
.bar{height:10px;border-radius:6px;background:var(--line);overflow:hidden;margin:12px 0 4px}
.bar>i{display:block;height:100%;background:var(--accent);transition:width .4s}
input[type=range]{width:100%;accent-color:var(--accent);margin:8px 0 0}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th{text-align:left;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);font-weight:600;padding:0 10px 8px 0;border-bottom:1px solid var(--line)}
td{padding:11px 10px 11px 0;border-bottom:1px solid var(--line);font-size:14px}
tr:last-child td{border-bottom:0}
.pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600}
.on{background:color-mix(in srgb,var(--ok) 15%,transparent);color:var(--ok)}
.offp{background:color-mix(in srgb,var(--off) 15%,transparent);color:var(--off)}
.gone{background:var(--line);color:var(--mut)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:14px}
.k{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut)}
.v{font-size:19px;font-weight:600;font-variant-numeric:tabular-nums}
.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--ok);margin-right:7px;vertical-align:middle}
.stale .dot{background:var(--off)}
@media(max-width:560px){.hide-s{display:none}}
</style></head><body><div class="wrap">

<h1>Power Bus</h1>
<div class="sub" id="sub">connecting…</div>

<div class="card">
  <div class="row"><span class="mut">Bus budget</span><span class="mut" id="alloc"></span></div>
  <div class="row"><span class="big"><span id="bud">–</span> W</span></div>
  <div class="bar"><i id="barfill" style="width:0%"></i></div>
  <input type="range" id="slider" min="0" max="150" step="5" value="100">
  <div class="mut">Drag to change the available power. Loads shed in priority order — lowest priority number survives longest.</div>
</div>

<div class="card">
  <table><thead><tr>
    <th>Node</th><th>State</th><th>Draw</th><th>Prio</th>
    <th class="hide-s">RTT</th><th class="hide-s">Frames</th>
  </tr></thead><tbody id="rows"></tbody></table>
</div>

<div class="card"><div class="grid">
  <div><div class="k">Link</div><div class="v" id="bps">–</div></div>
  <div><div class="k">Depth</div><div class="v" id="depth">–</div></div>
  <div><div class="k">CRC err</div><div class="v" id="crc">–</div></div>
  <div><div class="k">Resync</div><div class="v" id="sync">–</div></div>
  <div><div class="k">Uptime</div><div class="v" id="up">–</div></div>
</div></div>

<script>
const $=i=>document.getElementById(i);
let dragging=false;
$('slider').addEventListener('input',()=>{dragging=true;$('bud').textContent=($('slider').value/10).toFixed(1)});
$('slider').addEventListener('change',async()=>{
  await fetch('/api/budget?dw='+$('slider').value);dragging=false;tick()});

function hhmmss(s){const h=s/3600|0,m=s/60%60|0,x=s%60|0;
  return (h?h+'h ':'')+(h||m?m+'m ':'')+x+'s'}

async function tick(){
  let d;try{d=await(await fetch('/api/state')).json()}catch(e){
    $('sub').textContent='lost connection to the power node';return}
  $('sub').innerHTML='<span class="dot"></span>node 0 · '+d.nodes.length+
    ' load'+(d.nodes.length==1?'':'s')+' on the bus · data over the power wires';
  if(!dragging){$('bud').textContent=(d.budget_dW/10).toFixed(1);$('slider').value=d.budget_dW}
  $('alloc').textContent=(d.alloc_dW/10).toFixed(1)+' W allocated';
  $('barfill').style.width=Math.min(100,d.budget_dW?d.alloc_dW/d.budget_dW*100:0)+'%';
  const L=d.local;
  const lcls=!L.enabled?'gone':(L.on?'on':'offp');
  const ltxt=!L.enabled?'off':(L.on?'on':'shed');
  const localRow=`<tr><td><b>controller</b><div class="mut">critical · wired</div></td>
      <td><span class="pill ${lcls}">${ltxt}</span></td>
      <td>${(L.draw_dW/10).toFixed(1)} W</td><td>${L.prio}</td>
      <td class="hide-s">—</td><td class="hide-s">—</td></tr>`;
  $('rows').innerHTML=localRow+(d.nodes.length?d.nodes.map(n=>{
    const cls=!n.present?'gone':(n.on?'on':'offp');
    const txt=!n.present?'gone':(n.on?'on':'shed');
    return `<tr><td><b>load ${n.id}</b><div class="mut">adapter · over power line</div></td>
      <td><span class="pill ${cls}">${txt}</span></td>
      <td>${(n.draw_dW/10).toFixed(1)} W</td><td>${n.prio}</td>
      <td class="hide-s">${n.rtt} ms</td>
      <td class="hide-s">${n.ok}<span class="mut"> / ${n.ok+n.miss}</span></td></tr>`}).join('')
    : '<tr><td colspan="6" class="mut">no loads on the bus yet — plug one in and it will join itself</td></tr>');
  $('bps').textContent=d.bps+' bps';
  $('depth').textContent=d.depth;
  $('crc').textContent=d.crc;
  $('sync').textContent=d.sync;
  $('up').textContent=hhmmss(d.uptime);
}
tick();setInterval(tick,1000);
</script></div></body></html>)HTML";
