'use strict';
const CONFIG=window.KAKEIBO_CONFIG||{};
const TABLES=['categories','payment_methods','credit_cards','credit_card_terms','recurring_expenses','expenses'];
const db=new Dexie('financial_db');
db.version(1).stores({expenses:'id,category_id,expense_date,updated_at,is_deleted',categories:'id,name,updated_at,is_deleted',meta:'key'});
db.version(2).stores({expenses:'id,category_id,expense_date,payment_method_id,recurring_expense_id,updated_at,is_deleted',categories:'id,name,updated_at,is_deleted',payment_methods:'id,sort_order,is_default,is_deleted',credit_cards:'id,payment_method_id,is_deleted',credit_card_terms:'id,credit_card_id,effective_from',recurring_expenses:'id,frequency,start_date,is_deleted',pending:'++key,[table+id],table',meta:'key'});
const DEFAULT_CATS=[['11111111-0000-0000-0000-000000000001','食費','#dc8c8c'],['11111111-0000-0000-0000-000000000002','日用品','#7c9bd7'],['11111111-0000-0000-0000-000000000003','美容費','#b58dd9'],['11111111-0000-0000-0000-000000000004','交通費','#6bb6a6'],['11111111-0000-0000-0000-000000000005','医療費','#d6a66c'],['11111111-0000-0000-0000-000000000006','交際費','#8a91d7'],['11111111-0000-0000-0000-000000000007','特別費','#d9bd72'],['11111111-0000-0000-0000-000000000008','チャージ費','#79c4c6'],['11111111-0000-0000-0000-000000000009','消耗品費','#cf91aa']];
const $=id=>document.getElementById(id), yen=n=>'¥'+Number(n||0).toLocaleString('ja-JP'), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const iso=()=>new Date().toISOString(), localDate=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const parseDate=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d,12);};
const dateStr=d=>localDate(d), monthStart=s=>s.slice(0,7)+'-01', daysInMonth=(y,m)=>new Date(y,m,0).getDate();
const addDays=(s,n)=>{const d=parseDate(s);d.setDate(d.getDate()+n);return dateStr(d);};
const addMonths=(s,n)=>{const d=parseDate(s), y=d.getFullYear(),m=d.getMonth()+n;const first=new Date(y,m,1,12);return dateStr(new Date(first.getFullYear(),first.getMonth(),Math.min(d.getDate(),daysInMonth(first.getFullYear(),first.getMonth()+1)),12));};
const clampDay=(y,m,day)=>`${y}-${String(m).padStart(2,'0')}-${String(day===32?daysInMonth(y,m):Math.min(day,daysInMonth(y,m))).padStart(2,'0')}`;
const uuid=()=>crypto.randomUUID();
let currentPage='home',homeMode='graph',syncRunning=false,modalSave=null,activeManager=null;
let authClient=null,authSession=null,authenticatedUserId=null;
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').classList.remove('show'),3200);}
async function all(table,includeDeleted=false){const rows=await db[table].toArray();return includeDeleted?rows:rows.filter(r=>!r.is_deleted);}
async function queue(table,row){await db.transaction('rw',db[table],db.pending,async()=>{await db[table].put(row);const old=await db.pending.where('[table+id]').equals([table,row.id]).first();if(old)await db.pending.update(old.key,{row});else await db.pending.add({table,id:row.id,row});});updateSyncLabel();}
function touch(row){return {...row,updated_at:iso()};}
function options(rows,selected='',empty='選択してください'){return `<option value="">${esc(empty)}</option>`+rows.map(r=>`<option value="${esc(r.id)}" ${r.id===selected?'selected':''}>${esc(r.name)}</option>`).join('');}
async function selectData(){const [categories,methods,cards]=await Promise.all([all('categories'),all('payment_methods'),all('credit_cards')]);categories.sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));methods.sort((a,b)=>Number(!!b.is_default)-Number(!!a.is_default)||(a.sort_order||0)-(b.sort_order||0));return {categories,methods,cards};}
async function defaultPayment(){return (await all('payment_methods')).find(p=>p.is_default)?.id||'';}
function openModal(title,body,actions){$('modal-title').textContent=title;$('modal-body').innerHTML=body;$('modal-actions').innerHTML=actions||`<button class="btn secondary" onclick="closeModal()">閉じる</button>`;$('modal').classList.add('show');}
function closeModal(){$('modal').classList.remove('show');modalSave=null;}
function showPage(name){currentPage=name;document.querySelectorAll('.page').forEach(el=>el.classList.toggle('active',el.id==='page-'+name));document.querySelectorAll('.tabs button').forEach(el=>el.classList.toggle('active',el.dataset.page===name));$('fab').classList.toggle('hide',name!=='home');window.scrollTo(0,0);render();}
function setHomeMode(mode){homeMode=mode;$('seg-graph').classList.toggle('active',mode==='graph');$('seg-credit').classList.toggle('active',mode==='credit');$('home-graph').classList.toggle('hide',mode!=='graph');$('home-credit').classList.toggle('hide',mode!=='credit');renderHome();}
async function render(){if(currentPage==='home')await renderHome();if(currentPage==='summary')await renderSummary();if(currentPage==='edit')await renderEdit();if(currentPage==='settings')await updateSyncLabel();}
async function renderHome(){const today=localDate(),ym=today.slice(0,7),[expenses,cats]=await Promise.all([all('expenses'),all('categories',true)]);const rows=expenses.filter(e=>e.expense_date?.startsWith(ym));$('home-total').textContent=yen(rows.reduce((n,e)=>n+Number(e.amount),0));const by=new Map();rows.forEach(e=>by.set(e.category_id,(by.get(e.category_id)||0)+Number(e.amount)));const sorted=[...by.entries()].sort((a,b)=>b[1]-a[1]);const catMap=new Map(cats.map(c=>[c.id,c]));const max=Math.max(1,...sorted.map(r=>r[1]));$('bar-chart').innerHTML=sorted.length?sorted.map(([id,amt])=>{const c=catMap.get(id)||{name:'削除済み',color:'#aab3c1'};return `<div class="bar-column" title="${esc(c.name)} ${yen(amt)}"><div class="bar-amount">${amt>=10000?Math.round(amt/1000)+'k':amt}</div><div class="bar-shape" style="height:${Math.max(4,Math.round(150*amt/max))}px;background:${esc(c.color)}"></div><div class="bar-label">${esc(c.name)}</div></div>`;}).join(''):'<div class="empty" style="width:100%">今月の支出はまだありません</div>';
$('home-breakdown').innerHTML=sorted.map(([id,amt])=>{const c=catMap.get(id)||{name:'削除済みカテゴリ',color:'#aab3c1'};return `<div class="line"><div><span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name)}</div><span class="amount">${yen(amt)}</span></div>`;}).join('');if(homeMode==='credit')await renderCredit();}
function creditMonthSummary(byDate,yearMonth){
  const entries=[...byDate.entries()].filter(([date])=>date.startsWith(yearMonth)).sort(([a],[b])=>a.localeCompare(b));
  return {amount:entries.reduce((total,[,amount])=>total+amount,0),dates:entries.map(([date])=>date)};
}
async function renderCredit(){
  const [cards,terms,expenses]=await Promise.all([all('credit_cards'),all('credit_card_terms'),all('expenses')]);
  if(!cards.length){$('home-credit').innerHTML='<div class="empty">クレジットカードが登録された場合にご利用いただけます</div>';return;}
  const currentMonth=localDate().slice(0,7);
  const followingMonth=addMonths(currentMonth+'-01',1).slice(0,7);
  let html='';
  for(const card of cards){
    const cardTerms=terms.filter(t=>t.credit_card_id===card.id).sort((a,b)=>a.effective_from.localeCompare(b.effective_from));
    const byDate=new Map();
    for(const expense of expenses.filter(e=>e.payment_method_id===card.payment_method_id)){
      const term=cardTerms.findLast?cardTerms.findLast(t=>t.effective_from<=expense.expense_date):[...cardTerms].reverse().find(t=>t.effective_from<=expense.expense_date);
      if(!term)continue;
      const payment=paymentDate(expense.expense_date,term);
      byDate.set(payment,(byDate.get(payment)||0)+Number(expense.amount));
    }
    const current=creditMonthSummary(byDate,currentMonth);
    const following=creditMonthSummary(byDate,followingMonth);
    const dateLabel=summary=>summary.dates.length?`（${summary.dates.join('・')}）`:'';
    html+=`<div class="divider"></div><div class="card-head"><div class="card-icon" style="background:${esc(card.color)}">${esc(card.icon==='wallet'?'▣':'▤')}</div><b>${esc(card.name)}</b></div><div class="credit-payment-row"><div class="eyebrow">今月の支払額 ${dateLabel(current)}</div><div class="credit-num">${yen(current.amount)}</div></div><div class="credit-payment-row"><div class="eyebrow">来月の支払予定額 ${dateLabel(following)}</div><div class="credit-num">${yen(following.amount)}</div></div>`;
  }
  $('home-credit').innerHTML=html;
}
async function renderSummary(){const ym=$('summary-month').value;if(!ym)return;const [expenses,cats]=await Promise.all([all('expenses'),all('categories',true)]);const rows=expenses.filter(e=>e.expense_date?.startsWith(ym));const map=new Map(cats.map(c=>[c.id,c.name]));const grouped=new Map();rows.forEach(e=>grouped.set(e.category_id,(grouped.get(e.category_id)||0)+Number(e.amount)));$('summary-results').innerHTML=`<div class="eyebrow">支出合計</div><div class="hero">${yen(rows.reduce((s,e)=>s+Number(e.amount),0))}</div>`+([...grouped].sort((a,b)=>b[1]-a[1]).map(([id,v])=>`<div class="line"><span>${esc(map.get(id)||'削除済みカテゴリ')}</span><b>${yen(v)}</b></div>`).join('')||'<div class="empty">この月の支出はありません</div>');}
async function renderEdit(){const {categories,methods}=await selectData(),ym=$('edit-month').value;const cat=$('filter-category'),pay=$('filter-payment'),catVal=cat.value,payVal=pay.value;cat.innerHTML=options(categories,catVal,'すべて');pay.innerHTML=options(methods,payVal,'すべて');const allRows=await all('expenses',true),catMap=new Map((await all('categories',true)).map(c=>[c.id,c.name])),payMap=new Map((await all('payment_methods',true)).map(p=>[p.id,p.name]));const rows=allRows.filter(e=>(!ym||e.expense_date?.startsWith(ym))&&(!cat.value||e.category_id===cat.value)&&(!pay.value||e.payment_method_id===pay.value)&&($('show-deleted').checked||!e.is_deleted)).sort((a,b)=>b.expense_date.localeCompare(a.expense_date));$('edit-results').innerHTML=rows.map(e=>`<div class="line"><div><b>${esc(catMap.get(e.category_id)||'削除済みカテゴリ')}</b> ${e.is_deleted?'<span class="pill">削除済み</span>':''}<div class="sub">${esc(e.expense_date)} · ${esc(payMap.get(e.payment_method_id)||'未設定')} ${e.memo?'· '+esc(e.memo):''}</div></div><div style="text-align:right"><div class="amount">${yen(e.amount)}</div><button class="btn small secondary" onclick="openExpense('${e.id}')">${e.is_deleted?'復元':'編集'}</button></div></div>`).join('')||'<div class="empty">対象の支出はありません</div>';}
async function openExpense(id=''){const {categories,methods}=await selectData();if(!categories.length){toast('先にカテゴリを登録してください');return;}const existing=id?await db.expenses.get(id):null;const selected=existing?.payment_method_id??await defaultPayment();openModal(existing?(existing.is_deleted?'削除した支出':'支出を編集'):'支出を記録',`<div class="field"><label>カテゴリ</label><select id="f-category">${options(categories,existing?.category_id)}</select></div><div class="grid2"><div class="field"><label>金額（円）</label><input id="f-amount" type="number" min="1" step="1" inputmode="numeric" value="${existing?.amount||''}"></div><div class="field"><label>利用日</label><input id="f-date" type="date" value="${existing?.expense_date||localDate()}"></div></div><div class="field"><label>支払方法</label><select id="f-payment">${options(methods,selected,existing?'未設定':'選択してください')}</select></div><div class="field"><label>メモ（任意）</label><textarea id="f-memo" maxlength="500">${esc(existing?.memo||'')}</textarea></div>${existing?.recurring_expense_id?'<label class="notice"><input type="checkbox" id="f-future" style="width:auto"> 今後の未修正分にも反映する</label>':''}`,existing?.is_deleted?`<button class="btn secondary" onclick="closeModal()">閉じる</button><button class="btn" onclick="restoreExpense('${id}')">復元する</button>`:`<button class="btn secondary" onclick="closeModal()">キャンセル</button>${existing?`<button class="btn danger" onclick="deleteExpense('${id}')">削除</button>`:''}<button class="btn" onclick="saveExpense('${id}')">保存する</button>`);if(selected)$('f-payment').value=selected;}
async function saveExpense(id){const category_id=$('f-category').value,payment_method_id=$('f-payment').value,amount=Number($('f-amount').value),expense_date=$('f-date').value,memo=$('f-memo').value.trim();if(!category_id||!Number.isSafeInteger(amount)||amount<=0||!/^\d{4}-\d{2}-\d{2}$/.test(expense_date)||(!id&&!payment_method_id)){toast('入力内容を確認してください');return;}const old=id?await db.expenses.get(id):null;const row=touch({...old,id:id||uuid(),category_id,payment_method_id:payment_method_id||null,amount,expense_date,memo,created_at:old?.created_at||iso(),is_deleted:false,is_individually_modified:!!old?.recurring_expense_id});await queue('expenses',row);if(old?.recurring_expense_id&&$('f-future')?.checked){const template=await db.recurring_expenses.get(old.recurring_expense_id);if(template){await queue('recurring_expenses',touch({...template,category_id,payment_method_id:payment_method_id||null,amount,memo}));const siblings=(await all('expenses')).filter(e=>e.recurring_expense_id===template.id&&e.recurrence_date>=old.recurrence_date&&!e.is_individually_modified);for(const e of siblings)await queue('expenses',touch({...e,category_id,payment_method_id:payment_method_id||null,amount,memo}));}}closeModal();toast('支出を保存しました');showPage(id?'edit':'home');syncAll();}
async function deleteExpense(id){const old=await db.expenses.get(id);if(!old)return;await queue('expenses',touch({...old,is_deleted:true}));closeModal();render();syncAll();}
async function restoreExpense(id){const old=await db.expenses.get(id);if(!old)return;await queue('expenses',touch({...old,is_deleted:false}));closeModal();render();syncAll();}
async function openManager(type){activeManager=type;await renderManager();}
async function renderManager(){const type=activeManager;const names={categories:'カテゴリ管理',payment_methods:'支払方法管理',credit_cards:'クレジットカード管理',recurring_expenses:'繰り返し支出'};const rows=await all(type);if(type==='categories'||type==='payment_methods')rows.sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));let html=['categories','payment_methods'].includes(type)?'<p class="notice">項目を長押しせず、そのまま上下にドラッグして並び替えできます。編集ボタンは通常どおりタップできます。</p>':'';for(const r of rows){let desc='';if(type==='payment_methods')desc=r.is_default?'メインの支払方法':r.kind==='card'?'クレジットカード':'';if(type==='recurring_expenses')desc=`${{weekly:'毎週',monthly:'毎月',yearly:'毎年'}[r.frequency]} · ${yen(r.amount)}${r.paused?' · 停止中':''}`;html+=`<div class="setting-item ${['categories','payment_methods'].includes(type)?'sortable-row':''}" ${['categories','payment_methods'].includes(type)?`data-id="${r.id}"`:''}><div style="flex:1;min-width:0"><b>${esc(r.name||r.memo||r.start_date)}</b><div class="sub">${esc(desc)}</div></div>${type==='payment_methods'&&!r.is_default?`<button class="btn small secondary" onclick="setDefault('${r.id}')">メイン</button>`:''}<button class="btn small secondary" onclick="openEditor('${type}','${r.id}')">編集</button></div>`;}html+=rows.length?'':'<div class="empty">まだ登録されていません</div>';const add=type==='credit_cards'?'カードを追加':type==='recurring_expenses'?'繰り返し支出を追加':'追加する';openModal(names[type],html,`<button class="btn secondary" onclick="closeModal()">閉じる</button><button class="btn" onclick="openEditor('${type}')">${add}</button>`);if(type==='categories'||type==='payment_methods')enableTouchSorting(type);}
// Drag directly on each setting row. Buttons remain independently clickable.
function enableTouchSorting(type){
  const body=$('modal-body');
  const rows=body.querySelectorAll('.sortable-row');
  for(const source of rows){
    source.addEventListener('pointerdown',event=>{
      if(event.pointerType==='mouse'&&event.button!==0)return;
      if(event.target.closest('button, input, select, textarea, a, [contenteditable]'))return;
      event.preventDefault();
      const sourceId=source.dataset.id;
      let destinationId=sourceId;
      let finished=false;
      source.classList.add('sort-active');
      source.setPointerCapture(event.pointerId);
      const clear=()=>{
        source.removeEventListener('pointermove',onMove);
        source.removeEventListener('pointerup',finish);
        source.removeEventListener('pointercancel',cancel);
        source.classList.remove('sort-active');
        body.querySelectorAll('.sort-over').forEach(row=>row.classList.remove('sort-over'));
      };
      const onMove=e=>{
        e.preventDefault();
        const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('.sortable-row');
        body.querySelectorAll('.sort-over').forEach(row=>row.classList.remove('sort-over'));
        if(target&&body.contains(target)){
          destinationId=target.dataset.id;
          if(destinationId!==sourceId)target.classList.add('sort-over');
        }
        const bounds=body.getBoundingClientRect();
        if(e.clientY<bounds.top+48)body.scrollTop-=12;
        else if(e.clientY>bounds.bottom-48)body.scrollTop+=12;
      };
      const finish=async()=>{
        if(finished)return;
        finished=true;
        clear();
        if(destinationId!==sourceId){
          try{await reorderSettings(type,sourceId,destinationId);}
          catch(error){console.error(error);toast('並び替えに失敗しました');}
        }
      };
      const cancel=()=>{finished=true;clear();};
      source.addEventListener('pointermove',onMove);
      source.addEventListener('pointerup',finish);
      source.addEventListener('pointercancel',cancel);
    });
  }
}
async function reorderSettings(type,sourceId,targetId){
  const rows=(await all(type)).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
  const ids=rows.map(row=>row.id),from=ids.indexOf(sourceId),to=ids.indexOf(targetId);
  if(from<0||to<0||from===to)return;
  ids.splice(to,0,ids.splice(from,1)[0]);
  for(let i=0;i<ids.length;i++){
    const row=rows.find(item=>item.id===ids[i]);
    if(row.sort_order!==i)await queue(type,touch({...row,sort_order:i}));
  }
  await renderManager();
  syncAll();
}
async function setDefault(id){const methods=await all('payment_methods');for(const m of methods.filter(m=>m.is_default&&m.id!==id))await queue('payment_methods',touch({...m,is_default:false}));const row=await db.payment_methods.get(id);await queue('payment_methods',touch({...row,is_default:true}));await renderManager();syncAll();}
async function openEditor(type,id=''){const old=id?await db[type].get(id):null,{categories,methods}=await selectData();let fields='';const field=(name,label,control)=>`<div class="field"><label>${label}</label>${control}</div>`;
if(type==='categories')fields=field('name','カテゴリ名',`<input id="v-name" maxlength="30" value="${esc(old?.name||'')}">`)+field('color','カラー',`<input id="v-color" type="color" value="${esc(old?.color||'#7c9bd7')}">`);
if(type==='payment_methods')fields=field('name','支払方法名',`<input id="v-name" maxlength="40" value="${esc(old?.name||'')}">`)+field('kind','種別',`<select id="v-kind" ${old?.kind==='card'?'disabled':''}><option value="cash" ${old?.kind==='cash'?'selected':''}>現金</option><option value="other" ${!old||old.kind==='other'?'selected':''}>その他</option>${old?.kind==='card'?'<option value="card" selected>クレジットカード</option>':''}</select>`);
if(type==='credit_cards'){const terms=(await all('credit_card_terms')).filter(t=>t.credit_card_id===id).sort((a,b)=>b.effective_from.localeCompare(a.effective_from)),t=terms[0];fields=field('name','カード名',`<input id="v-name" maxlength="40" value="${esc(old?.name||'')}">`)+`<div class="grid2">${field('closing','締め日（32＝月末）',`<select id="v-closing">${dayOptions(t?.closing_day||32)}</select>`)}${field('payment','支払日（32＝月末）',`<select id="v-payment">${dayOptions(t?.payment_day||10)}</select>`)}</div>`+field('offset','支払月（締め月を基準）',`<select id="v-offset"><option value="0">当月</option><option value="1">翌月</option><option value="2">翌々月</option><option value="3">3か月後</option></select>`)+`<div class="grid2">${field('color','カードカラー',`<input type="color" id="v-color" value="${esc(old?.color||'#708ad4')}">`)}${field('icon','アイコン',`<select id="v-icon"><option value="credit-card">カード</option><option value="wallet">ウォレット</option></select>`)}</div>`+(id?field('effective','新設定の適用開始日',`<input id="v-effective" type="date" value="${localDate()}">`):'');setTimeout(()=>{if($('v-offset'))$('v-offset').value=String(t?.payment_month_offset??1);if($('v-icon'))$('v-icon').value=old?.icon||'credit-card';},0);}
if(type==='recurring_expenses')fields=field('category','カテゴリ',`<select id="v-category">${options(categories,old?.category_id)}</select>`)+`<div class="grid2">${field('amount','金額',`<input type="number" id="v-amount" min="1" step="1" value="${old?.amount||''}">`)}${field('frequency','周期',`<select id="v-frequency"><option value="weekly">毎週</option><option value="monthly">毎月</option><option value="yearly">毎年</option></select>`)}</div>`+field('payment','支払方法',`<select id="v-payment-method">${options(methods,old?.payment_method_id)}</select>`)+`<div class="grid2">${field('start','開始日',`<input type="date" id="v-start" value="${old?.start_date||localDate()}">`)}${field('end','終了日（任意）',`<input type="date" id="v-end" value="${old?.end_date||''}">`)}</div>`+field('memo','メモ',`<textarea id="v-memo">${esc(old?.memo||'')}</textarea>`)+(id?`<label class="notice"><input id="v-paused" type="checkbox" style="width:auto" ${old?.paused?'checked':''}> 一時停止する</label>`:'');setTimeout(()=>{if($('v-frequency'))$('v-frequency').value=old?.frequency||'monthly';},0);
openModal(id?'編集':'新規登録',fields+(id?'<p class="notice">削除しても過去の履歴は保持されます。</p>':''),`<button class="btn secondary" onclick="renderManager()">戻る</button>${id?`<button class="btn danger" onclick="removeSetting('${type}','${id}')">削除</button>`:''}<button class="btn" onclick="saveSetting('${type}','${id}')">保存</button>`);}
function dayOptions(selected){return Array.from({length:31},(_,i)=>i+1).concat(32).map(d=>`<option value="${d}" ${d===selected?'selected':''}>${d===32?'月末':d+'日'}</option>`).join('');}
async function saveSetting(type,id){const old=id?await db[type].get(id):null,n=iso(),base={...old,id:id||uuid(),created_at:old?.created_at||n,updated_at:n,is_deleted:false};let row={...base};if(type==='categories'){row.name=$('v-name').value.trim();row.color=$('v-color').value;row.sort_order=old?.sort_order??(await all(type)).length;if(!row.name)return toast('名前を入力してください');}
if(type==='payment_methods'){row.name=$('v-name').value.trim();row.kind=$('v-kind').value;row.is_default=old?.is_default??!(await all(type)).length;row.sort_order=old?.sort_order??(await all(type)).length;if(!row.name)return toast('名前を入力してください');}
if(type==='credit_cards'){row.name=$('v-name').value.trim();row.color=$('v-color').value;row.icon=$('v-icon').value;if(!row.name)return toast('カード名を入力してください');if(!old){const pm={id:uuid(),name:row.name,kind:'card',is_default:!(await all('payment_methods')).length,sort_order:(await all('payment_methods')).length,created_at:n,updated_at:n,is_deleted:false};await queue('payment_methods',pm);row.payment_method_id=pm.id;}else{const pm=await db.payment_methods.get(old.payment_method_id);if(pm&&pm.name!==row.name)await queue('payment_methods',touch({...pm,name:row.name}));}const closing_day=Number($('v-closing').value),payment_day=Number($('v-payment').value),payment_month_offset=Number($('v-offset').value),effective_from=old?$('v-effective').value:'1900-01-01';if(!effective_from)return toast('適用開始日を入力してください');const terms=(await all('credit_card_terms')).filter(t=>t.credit_card_id===row.id);if(terms.some(t=>t.effective_from===effective_from))return toast('同じ適用開始日の設定が既に存在します');await queue(type,row);await queue('credit_card_terms',{id:uuid(),credit_card_id:row.id,closing_day,payment_day,payment_month_offset,effective_from,created_at:n,updated_at:n,is_deleted:false});await renderManager();render();syncAll();return;}
if(type==='recurring_expenses'){row.category_id=$('v-category').value;row.payment_method_id=$('v-payment-method').value||null;row.amount=Number($('v-amount').value);row.frequency=$('v-frequency').value;row.start_date=$('v-start').value;row.end_date=$('v-end').value||null;row.memo=$('v-memo').value.trim();row.paused=$('v-paused')?.checked||false;if(!row.category_id||!row.payment_method_id||!Number.isSafeInteger(row.amount)||row.amount<=0||!row.start_date||(row.end_date&&row.end_date<row.start_date))return toast('入力内容を確認してください');}
await queue(type,row);
if(type==='recurring_expenses'&&old){
  const existing=await all('expenses');
  for(const expense of existing.filter(e=>e.recurring_expense_id===id&&!e.is_individually_modified&&e.recurrence_date>=localDate())){
    await queue('expenses',touch({...expense,category_id:row.category_id,payment_method_id:row.payment_method_id,amount:row.amount,memo:row.memo}));
  }
}
await renderManager();await generateRecurring();await render();syncAll();}
async function removeSetting(type,id){const row=await db[type].get(id);if(!row)return;if(!confirm('削除しますか？過去の履歴は保持します。'))return;await queue(type,touch({...row,is_deleted:true,is_default:false}));if(type==='credit_cards'){const pm=await db.payment_methods.get(row.payment_method_id);if(pm)await queue('payment_methods',touch({...pm,is_deleted:true,is_default:false}));}await renderManager();render();syncAll();}
// 日本の祝日: 2000〜2099年の現行の基本ルールを使用。将来の法改正・臨時祝日は別途更新が必要。
function japaneseHolidays(year){const set=new Set(),put=(m,d)=>set.add(clampDay(year,m,d));if(year<2000||year>2099)return set;[[1,1],[2,11],[2,23],[4,29],[5,3],[5,4],[5,5],[8,11],[11,3],[11,23]].forEach(([m,d])=>put(m,d));
const nthMonday=(m,n)=>{const first=new Date(year,m-1,1).getDay();return 1+(8-first)%7+7*(n-1);};put(1,nthMonday(1,2));put(7,nthMonday(7,3));put(9,nthMonday(9,3));put(10,nthMonday(10,2));
const spring=Math.floor(20.8431+0.242194*(year-1980)-Math.floor((year-1980)/4)),autumn=Math.floor(23.2488+0.242194*(year-1980)-Math.floor((year-1980)/4));put(3,spring);put(9,autumn);
// 振替休日: 日曜日の祝日の次の平日（祝日でない日）
for(const h of [...set].sort()){if(parseDate(h).getDay()===0){let next=addDays(h,1);while(set.has(next))next=addDays(next,1);set.add(next);}}
// 国民の休日: 前後を祝日に挟まれた平日
for(let d=addDays(`${year}-01-01`,1);d<`${year}-12-31`;d=addDays(d,1)){if(!set.has(d)&&set.has(addDays(d,-1))&&set.has(addDays(d,1)))set.add(d);}
return set;}
function nextBusinessDay(s){let date=s;for(let i=0;i<20;i++){const d=parseDate(date),day=d.getDay();if(day!==0&&day!==6&&!japaneseHolidays(d.getFullYear()).has(date)&&!(d.getMonth()===11&&d.getDate()===31)&&!(d.getMonth()===0&&d.getDate()<=3))return date;date=addDays(date,1);}throw Error('営業日を算出できません');}
function paymentDate(usage,term){const [y,m]=usage.split('-').map(Number),closing=clampDay(y,m,term.closing_day);const closeMonth=usage<=closing?`${y}-${String(m).padStart(2,'0')}-01`:addMonths(`${y}-${String(m).padStart(2,'0')}-01`,1);const shifted=addMonths(closeMonth,term.payment_month_offset),[py,pm]=shifted.split('-').map(Number);return nextBusinessDay(clampDay(py,pm,term.payment_day));}
async function deterministicId(input){const data=new TextEncoder().encode(input),digest=await crypto.subtle.digest('SHA-256',data),bytes=new Uint8Array(digest).slice(0,16);bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const hex=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;}
function occurrenceDate(start,frequency,index){if(frequency==='weekly')return addDays(start,index*7);const [y,m,d]=start.split('-').map(Number);if(frequency==='monthly'){const first=new Date(y,m-1+index,1,12);return clampDay(first.getFullYear(),first.getMonth()+1,d);}return clampDay(y+index,m,d);}
async function generateRecurring(){const today=localDate(),templates=await all('recurring_expenses');for(const t of templates){if(t.paused||!t.start_date||t.start_date>today)continue;for(let i=0;i<5000;i++){const date=occurrenceDate(t.start_date,t.frequency,i);if(date>today||t.end_date&&date>t.end_date)break;const id=await deterministicId(t.id+'|'+date);if(await db.expenses.get(id))continue;const n=iso();await queue('expenses',{id,category_id:t.category_id,payment_method_id:t.payment_method_id,amount:t.amount,memo:t.memo||'',expense_date:date,recurring_expense_id:t.id,recurrence_date:date,is_individually_modified:false,is_deleted:false,created_at:n,updated_at:n});}}}
// ローカル未同期レコードを先に送信し、成功した分だけキューから削除する。
async function remote(method,table,body){if(!authSession?.access_token)throw Error('ログインが必要です');const res=await fetch(`${CONFIG.url}/rest/v1/${table}${method==='GET'?'?select=*':''}`,{method,headers:{apikey:CONFIG.key,Authorization:`Bearer ${authSession.access_token}`,'Content-Type':'application/json',Prefer:method==='POST'?'resolution=merge-duplicates,return=minimal':'return=representation'},body:body?JSON.stringify(body):undefined});if(!res.ok)throw Error(`${table}: HTTP ${res.status} ${await res.text()}`);return method==='GET'?res.json():null;}
async function updateSyncLabel(error=false){const n=await db.pending.count();$('sync-status').textContent=error||!navigator.onLine?`● 未同期 ${n}件`:`${n?'◌ 未同期 '+n+'件':'✓ 同期済み'}`;$('sync-detail').textContent=`未同期 ${n}件 ／ ${navigator.onLine?'オンライン':'オフライン'}`;}
async function syncAll(){if(!authSession?.access_token||!authenticatedUserId)return;if(syncRunning)return;syncRunning=true;let error=false;try{if(!navigator.onLine)throw Error('オフラインです');await generateRecurring();for(const p of await db.pending.orderBy('key').toArray()){await remote('POST',p.table,[p.row]);const current=await db.pending.get(p.key);if(current&&current.row.updated_at===p.row.updated_at)await db.pending.delete(p.key);}for(const table of TABLES){const rows=await remote('GET',table);for(const row of rows){if(await db.pending.where('[table+id]').equals([table,row.id]).count())continue;await db[table].put(row);}}await generateRecurring();for(const p of await db.pending.orderBy('key').toArray()){await remote('POST',p.table,[p.row]);const current=await db.pending.get(p.key);if(current&&current.row.updated_at===p.row.updated_at)await db.pending.delete(p.key);}await render();}catch(e){error=true;console.warn('[Sync]',e);toast('同期できませんでした。ローカルデータは保持しています。');}finally{syncRunning=false;await updateSyncLabel(error);}}
async function initialize(){if(!authenticatedUserId)throw Error('認証が必要です');if(typeof Dexie==='undefined'){alert('Dexieを読み込めません。通信環境を確認してください。');return;}const today=localDate();$('month-caption').textContent=`${parseDate(today).getFullYear()}年${parseDate(today).getMonth()+1}月`;$('summary-month').value=today.slice(0,7);$('edit-month').value=today.slice(0,7);const existing=await db.meta.get('initialized_categories');
if(!(await db.payment_methods.count())){const n=iso();await queue('payment_methods',{id:'22222222-0000-4000-8000-000000000001',name:'現金',kind:'cash',is_default:true,sort_order:0,created_at:n,updated_at:n,is_deleted:false});}if(!existing){const count=await db.categories.count();if(count===0){for(let i=0;i<DEFAULT_CATS.length;i++){const [id,name,color]=DEFAULT_CATS[i],n=iso();await queue('categories',{id,name,color,sort_order:i,created_at:n,updated_at:n,is_deleted:false});}}await db.meta.put({key:'initialized_categories',value:true});}await generateRecurring();await render();await updateSyncLabel();syncAll();if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(console.warn);}
// Auth bootstrap: the UI is hidden until a verified Supabase Auth session is available.
function authView(show){$('auth-screen').classList.toggle('hide',!show);$('app-shell').classList.toggle('hide',show);$('fab').classList.toggle('hide',show||currentPage!=='home');$('bottom-tabs').classList.toggle('hide',show);}
function authMessage(message){$('auth-error').textContent=message||'';}
async function login(){
  const username=$('auth-username').value.trim(),password=$('auth-password').value;
  const email=CONFIG.authUsers?.[username];
  if(!email||!password){authMessage('ユーザー名またはパスワードが正しくありません。');return;}
  $('auth-submit').disabled=true;authMessage('');
  try{
    const {data,error}=await authClient.auth.signInWithPassword({email,password});
    if(error||!data.session)throw Error('認証できませんでした。');
    $('auth-password').value='';
    await acceptSession(data.session);
  }catch(e){console.warn('[Auth]',e);authMessage('ログインできませんでした。ユーザー名とパスワードを確認してください。');}
  finally{$('auth-submit').disabled=false;}
}
async function acceptSession(session){
  if(!session?.user?.id||!session.access_token){authView(true);return;}
  // The same shared budget can be used by two authorized accounts, but local cache is user-specific.
  const uid=session.user.id;
  const previous=localStorage.getItem('kakeibo-local-user');
  if(previous&&previous!==uid){
    const pending=await db.pending.count();
    if(pending)throw Error('別ユーザーの未同期データがあります。元のユーザーで同期してから切り替えてください。');
    await db.delete();await db.open();
  }
  localStorage.setItem('kakeibo-local-user',uid);
  authSession=session;authenticatedUserId=uid;
  authView(false);
  if(!window.kakeiboInitialized){window.kakeiboInitialized=true;await initialize();}
  else{await render();syncAll();}
}
async function logout(){
  if(await db.pending.count()){toast('未同期データがあります。同期後にログアウトしてください。');return;}
  if(!confirm('ログアウトしますか？この端末の家計簿キャッシュを削除します。'))return;
  await authClient.auth.signOut();authSession=null;authenticatedUserId=null;
  await db.delete();await db.open();
  localStorage.removeItem('kakeibo-local-user');
  window.kakeiboInitialized=false;
  authView(true);authMessage('');
}
async function bootstrapAuth(){
  authView(true);
  if(!CONFIG.url||!CONFIG.key||!CONFIG.authUsers||!Object.keys(CONFIG.authUsers).length){authMessage('config.js にログインユーザーを設定してください。');return;}
  if(!window.supabase?.createClient){authMessage('認証ライブラリを読み込めませんでした。');return;}
  authClient=window.supabase.createClient(CONFIG.url,CONFIG.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  authClient.auth.onAuthStateChange((event,session)=>{
    if(event==='TOKEN_REFRESHED'&&session)authSession=session;
    if(event==='SIGNED_OUT'){authSession=null;authenticatedUserId=null;authView(true);}
  });
  try{
    const {data,error}=await authClient.auth.getSession();if(error)throw error;
    if(data.session){
      const {data:userData,error:userError}=await authClient.auth.getUser();
      if(userError||!userData.user)throw userError||Error('認証情報を検証できません');
      await acceptSession(data.session);
    }
  }catch(e){console.warn('[Auth]',e);authMessage('セッションを確認できませんでした。再ログインしてください。');}
}
window.addEventListener('online',()=>syncAll());window.addEventListener('offline',()=>{if(authenticatedUserId)updateSyncLabel(true);});document.addEventListener('visibilitychange',()=>{if(!document.hidden&&authenticatedUserId)syncAll();});
bootstrapAuth().catch(e=>{console.error(e);authMessage('初期化に失敗しました。画面を再読み込みしてください。');});
