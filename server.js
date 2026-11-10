const express=require('express'),path=require('path'),fs=require('fs'),crypto=require('crypto');
const multer=require('multer'),sharp=require('sharp'),Database=require('better-sqlite3');
const E=process.env,BASE=E.BASE_URL||'http://localhost:3000',PRIV='storage/private',PUB='storage/public';
const stripe=E.STRIPE_SECRET_KEY?require('stripe')(E.STRIPE_SECRET_KEY):null;
const db=new Database('shop.db');
db.exec(`CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY,name,type,creator,meta,descr,price_cents INTEGER,kind,cover,blur,thumbs,active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS files(id INTEGER PRIMARY KEY,product_id INTEGER,name,path);
CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,email,kind,status TEXT DEFAULT 'pending',total_cents INTEGER,items,token,created INTEGER,downloads INTEGER DEFAULT 0);`);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const page=(t,b)=>`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(t)}</title><body style="font:16px system-ui;max-width:640px;margin:40px auto;padding:0 16px"><h1>${esc(t)}</h1>${b}`;

function markPaid(id){
  const o=db.prepare("UPDATE orders SET status='paid' WHERE id=? AND status='pending' RETURNING *").get(id);
  if(!o||o.kind!=='digital')return;
  const link=`${BASE}/d/${o.token}`;console.log('Descargas del pedido',id,link);
  if(E.SMTP_URL)require('nodemailer').createTransport(E.SMTP_URL).sendMail({from:E.MAIL_FROM,to:o.email,subject:'Tus descargas',text:`Gracias por tu compra. Descarga aquí (válido 7 días): ${link}`}).catch(console.error);
}

const app=express();
app.post('/webhook/stripe',express.raw({type:'*/*'}),(req,res)=>{try{
  const ev=stripe.webhooks.constructEvent(req.body,req.headers['stripe-signature'],E.STRIPE_WEBHOOK_SECRET);
  if(ev.type==='checkout.session.completed')markPaid(ev.data.object.metadata.orderId);res.sendStatus(200)}catch(e){res.status(400).send(e.message)}});
// Webhook genérico para tu procesador de contenido adulto: adapta la verificación a su documentación.
app.post('/webhook/digital',express.raw({type:'*/*'}),(req,res)=>{
  const sig=crypto.createHmac('sha256',E.DIGITAL_WEBHOOK_SECRET||'').update(req.body).digest('hex');
  if(!E.DIGITAL_WEBHOOK_SECRET||sig!==req.headers['x-signature'])return res.sendStatus(401);
  const d=JSON.parse(req.body);if(d.status==='paid')markPaid(d.orderId);res.sendStatus(200)});

app.use(express.static('public'));app.use('/media',express.static(PUB));

app.get('/api/products',(q,r)=>r.json(db.prepare('SELECT * FROM products WHERE active=1').all().map(p=>({
  id:p.id,n:p.name,t:p.type,a:p.creator,m:p.meta,d:p.descr,p:p.price_cents/100,c:['#7a1240','#ff7aa3'],kind:p.kind,cover:p.cover,blur:p.blur,thumbs:JSON.parse(p.thumbs||'[]')}))));

app.post('/api/checkout',express.json(),async(req,res)=>{try{
  const {items,email}=req.body;if(!/^\S+@\S+\.\S+$/.test(email||''))return res.status(400).json({error:'Correo inválido'});
  const rows=(items||[]).map(i=>({p:db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(i.id),q:Math.max(1,Math.min(10,+i.q||1))}));
  if(!rows.length||rows.some(r=>!r.p))return res.status(400).json({error:'Carrito inválido'});
  const kinds=[...new Set(rows.map(r=>r.p.kind))];if(kinds.length>1)return res.status(400).json({error:'Paga packs y objetos por separado'});
  const kind=kinds[0],total=rows.reduce((s,r)=>s+r.p.price_cents*r.q,0),id=crypto.randomUUID(),token=crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO orders(id,email,kind,total_cents,items,token,created) VALUES(?,?,?,?,?,?,?)').run(id,email,kind,total,JSON.stringify(rows.map(r=>({id:r.p.id,q:r.q}))),token,Date.now());
  if(kind==='physical'){
    if(!stripe)throw Error('Configura STRIPE_SECRET_KEY');
    const s=await stripe.checkout.sessions.create({mode:'payment',customer_email:email,metadata:{orderId:id},
      shipping_address_collection:{allowed_countries:(E.SHIP_COUNTRIES||'NL').split(',')},
      line_items:rows.map(r=>({quantity:r.q,price_data:{currency:'usd',unit_amount:r.p.price_cents,product_data:{name:r.p.name}}})),
      success_url:`${BASE}/gracias?o=${id}`,cancel_url:BASE});
    return res.json({url:s.url});
  }
  if((E.DIGITAL_PROVIDER||'mock')==='mock'){markPaid(id);return res.json({url:`${BASE}/gracias?o=${id}`})}
  // AQUÍ: crea el cobro con tu procesador adulto (CCBill, Segpay, Verotel…) enviando orderId y devuelve {url}.
  throw Error('Conecta tu procesador de packs (ver README, sección Pagos)');
}catch(e){res.status(500).json({error:e.message})}});

app.get('/gracias',(req,res)=>{const o=db.prepare('SELECT * FROM orders WHERE id=?').get(req.query.o);if(!o)return res.sendStatus(404);
  res.send(page('¡Gracias!',o.status!=='paid'?'<p>Confirmando tu pago… recarga en unos segundos.</p>':o.kind==='digital'?`<p>Pago confirmado. <a href="/d/${o.token}">Ir a mis descargas</a> (también te llegan por correo).</p>`:'<p>Pago confirmado. Prepararemos tu pedido en empaque discreto.</p>'))});

const okTok=t=>{const o=db.prepare("SELECT * FROM orders WHERE token=? AND status='paid' AND kind='digital'").get(t);return o&&Date.now()-o.created<7*864e5&&o.downloads<30?o:null};
app.get('/d/:t',(req,res)=>{const o=okTok(req.params.t);if(!o)return res.status(410).send('Enlace vencido o inválido');
  const fl=JSON.parse(o.items).flatMap(i=>db.prepare('SELECT * FROM files WHERE product_id=?').all(i.id));
  res.send(page('Tus descargas','<ul>'+fl.map(f=>`<li><a href="/f/${o.token}/${f.id}">${esc(f.name)}</a></li>`).join('')+'</ul><p>Válido 7 días, hasta 30 descargas.</p>'))});
app.get('/f/:t/:id',(req,res)=>{const o=okTok(req.params.t);if(!o)return res.sendStatus(410);
  const f=db.prepare('SELECT * FROM files WHERE id=?').get(req.params.id);
  if(!f||!JSON.parse(o.items).some(i=>i.id===f.product_id))return res.sendStatus(404);
  db.prepare('UPDATE orders SET downloads=downloads+1 WHERE id=?').run(o.id);res.download(path.resolve(f.path),f.name)});

const auth=(req,res,next)=>{const s=Buffer.from((req.headers.authorization||'').slice(6),'base64').toString(),i=s.indexOf(':');
  if(E.ADMIN_PASS&&s.slice(0,i)===(E.ADMIN_USER||'admin')&&s.slice(i+1)===E.ADMIN_PASS)return next();res.set('WWW-Authenticate','Basic').sendStatus(401)};
app.get('/admin',auth,(req,res)=>res.send(page('Admin',`<form method=post action=/admin/products enctype=multipart/form-data style="display:grid;gap:8px">
<input name=name placeholder=Nombre required><select name=type><option>Fotos<option>Videos<option>Combo<option>Objeto</select>
<input name=creator placeholder=Creador><input name=meta placeholder="Ej: 40 fotos HD"><textarea name=descr placeholder=Descripción></textarea>
<input name=price type=number step=0.01 placeholder="Precio USD" required><select name=kind><option value=digital>Pack digital<option value=physical>Objeto físico</select>
<label>Portada (visible) <input type=file name=cover accept=image/* required></label>
<label>Archivos del pack (fotos/videos, quedan privados) <input type=file name=files multiple></label><button>Publicar</button></form>
<h2>Productos</h2>`+db.prepare('SELECT * FROM products').all().map(p=>`<p>${esc(p.name)} · ${p.kind} · $${p.price_cents/100}</p>`).join(''))));
const up=multer({dest:'storage/tmp',limits:{fileSize:2e9}});
app.post('/admin/products',auth,up.fields([{name:'cover',maxCount:1},{name:'files',maxCount:200}]),async(req,res)=>{try{
  const b=req.body,cv=req.files.cover?.[0];if(!cv)return res.status(400).send('Falta la portada');
  const base=crypto.randomBytes(8).toString('hex');
  await sharp(cv.path).rotate().resize(1200,1200,{fit:'cover'}).webp({quality:82}).toFile(`${PUB}/${base}-cover.webp`);
  await sharp(cv.path).rotate().resize(300,300,{fit:'cover'}).blur(25).webp({quality:60}).toFile(`${PUB}/${base}-blur.webp`);
  fs.unlinkSync(cv.path);
  const r=db.prepare('INSERT INTO products(name,type,creator,meta,descr,price_cents,kind,cover,blur) VALUES(?,?,?,?,?,?,?,?,?)').run(b.name,b.type,b.creator,b.meta,b.descr,Math.round(b.price*100),b.kind,`/media/${base}-cover.webp`,`/media/${base}-blur.webp`);
  const thumbs=[];
  for(const f of req.files.files||[]){
    const dest=`${PRIV}/${r.lastInsertRowid}-${crypto.randomBytes(4).toString('hex')}-${f.originalname.replace(/[^\w.-]/g,'_')}`;
    if(f.mimetype.startsWith('image/')&&thumbs.length<8){const n=`${base}-t${thumbs.length}.webp`;await sharp(f.path).rotate().resize(300,300,{fit:'cover'}).blur(25).webp({quality:60}).toFile(`${PUB}/${n}`);thumbs.push(`/media/${n}`)}
    fs.renameSync(f.path,dest);db.prepare('INSERT INTO files(product_id,name,path) VALUES(?,?,?)').run(r.lastInsertRowid,f.originalname,dest);
  }
  db.prepare('UPDATE products SET thumbs=? WHERE id=?').run(JSON.stringify(thumbs),r.lastInsertRowid);res.redirect('/admin');
}catch(e){res.status(500).send(e.message)}});
app.listen(process.env.PORT||3000,()=>console.log('Tienda en',BASE));
