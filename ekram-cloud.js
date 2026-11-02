/* ekram-cloud.js — مزامنة سحابية + حسابات + شاشة دخول + مساعد ذكي (Firebase) */
(function () {
  // ====== 1) ضع بيانات مشروع Firebase هنا (من Project settings > Your apps) ======
  const firebaseConfig = {
    apiKey: "ضع_API_KEY",
    authDomain: "ضع_PROJECT_ID.firebaseapp.com",
    projectId: "ضع_PROJECT_ID",
    appId: "ضع_APP_ID"
  };
  const ADMIN_EMAIL = "admin@ekram.hr"; // حساب مدير النظام الأول (تنشئه من لوحة Firebase)
  const DOMAIN = "@ekram.hr";

  firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth(), db = firebase.firestore();
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toEmail = u => { u = u.trim().toLowerCase(); return u.includes('@') ? u : u + DOMAIN; };
  let me = null, unsubs = [], usersCache = [];

  // ====== 2) شاشة الدخول: نصفين 50/50 ======
  $('login-modal').outerHTML = `
  <div id="login-modal" class="fixed inset-0 z-50 flex flex-col md:flex-row bg-white">
    <div class="flex-1 flex items-center justify-center p-6 bg-slate-50">
      <div class="w-full max-w-sm space-y-4 text-sm">
        <h2 class="text-xl font-black text-blue-900"><i class="fa-solid fa-lock ml-1"></i> تسجيل الدخول</h2>
        <div><label class="block font-bold text-slate-700 mb-1">اسم المستخدم</label>
          <input id="login-username" type="text" autocomplete="username" class="w-full border border-slate-300 p-2.5 rounded text-slate-900 font-bold"></div>
        <div><label class="block font-bold text-slate-700 mb-1">كلمة المرور</label>
          <input id="login-pass" type="password" autocomplete="current-password" onkeydown="if(event.key==='Enter')handleLogin()" class="w-full border border-slate-300 p-2.5 rounded text-slate-900"></div>
        <p id="login-error" class="text-red-600 font-bold min-h-[1.25rem]"></p>
        <button onclick="handleLogin()" class="w-full bg-blue-700 hover:bg-blue-800 text-white font-bold py-2.5 rounded shadow">دخول للنظام</button>
      </div>
    </div>
    <div class="flex-1 bg-blue-900 text-white flex flex-col items-center justify-center p-8 text-center gap-3">
      <img src="logo.png" alt="" onerror="this.style.display='none'" class="w-40 h-40 object-contain">
      <h1 class="text-2xl font-black">إدارة الموارد البشرية</h1>
      <h2 class="text-lg font-bold">مؤسسة إكرام للتنمية والأعمال الخيرية EKRAM</h2>
      <p class="text-sm text-blue-200">مشهرة برقم 2020/6830</p>
    </div>
  </div>`;

  // ====== 3) المزامنة: كل ما يُحفظ في المتصفح يُرفع للسحابة ويصل لباقي الأجهزة ======
  const STORES = {
    hr_system_employees_v21: { p: 'emp', t: 'arr', get: () => employees, set: v => { employees = v; } },
    hr_system_trash_v21: { p: 'trash', t: 'arr', get: () => trashBin, set: v => { trashBin = v; } },
    hr_system_leaves_v21: { p: 'leave', t: 'arr', get: () => leavesList, set: v => { leavesList = v; } },
    app_audit_logs_v22: { p: 'audit', t: 'arr', get: () => auditLogs, set: v => { auditLogs = v; } },
    hr_system_custom_att_v21: { p: 'att', t: 'map', get: () => customAttendanceLogs, set: v => { customAttendanceLogs = v; } },
    app_roles_permissions_v22: { p: 'roles', t: 'one', get: () => rolesPermissions, set: v => { rolesPermissions = v; } },
    app_company_logos: { p: 'logos', t: 'one', get: () => companyLogos, set: v => { companyLogos = v; } },
    app_internal_rules_file: { p: 'rules', t: 'one', get: () => internalRulesFile, set: v => { internalRulesFile = v; } }
  };
  const sent = {}, timers = {};
  const docId = (p, id) => p + '__' + String(id).replace(/\//g, '_');
  const canWrite = key => me && (['level1', 'level2', 'level4'].includes(me.role) || key === 'app_audit_logs_v22');

  function items(key) {
    const s = STORES[key], v = s.get();
    if (s.t === 'arr') return (v || []).map(x => [docId(s.p, x.id), x]);
    if (s.t === 'map') return Object.entries(v || {}).map(([k, x]) => [docId(s.p, k), x]);
    return v == null ? [] : [[s.p + '__one', v]];
  }
  async function doPush(key) {
    if (!canWrite(key)) return;
    const s = STORES[key], cur = new Map(items(key)), ops = [];
    cur.forEach((x, id) => { const j = JSON.stringify(x); if (sent[id] !== j) ops.push(db.collection('hr_data').doc(id).set({ store: key, v: j }).then(() => { sent[id] = j; })); });
    Object.keys(sent).filter(id => id.startsWith(s.p + '__') && !cur.has(id)).forEach(id => ops.push(db.collection('hr_data').doc(id).delete().then(() => { delete sent[id]; })));
    try { await Promise.all(ops); } catch (e) { console.error(e); alert('تعذر حفظ التعديل في السحابة. قد تكون الصلاحية غير كافية أو حجم الصور كبير.'); }
  }
  const push = key => { clearTimeout(timers[key]); timers[key] = setTimeout(() => doPush(key), 400); };

  const origSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) { origSet.call(this, k, v); if (this === localStorage && STORES[k]) push(k); };

  function rebuild(key) {
    const s = STORES[key], ids = Object.keys(sent).filter(i => i.startsWith(s.p + '__')); let val;
    if (s.t === 'arr') val = ids.map(i => JSON.parse(sent[i])).sort((a, b) => key === 'app_audit_logs_v22' ? b.id - a.id : a.id - b.id);
    else if (s.t === 'map') { val = {}; ids.forEach(i => { val[i.slice(s.p.length + 2)] = JSON.parse(sent[i]); }); }
    else val = ids.length ? JSON.parse(sent[ids[0]]) : s.get();
    s.set(val);
    origSet.call(localStorage, key, typeof val === 'string' ? val : JSON.stringify(val));
  }
  function startSync() {
    unsubs.forEach(u => u()); unsubs = [];
    unsubs.push(db.collection('hr_data').onSnapshot(snap => {
      if (snap.empty && !snap.metadata.fromCache) { Object.keys(STORES).forEach(push); return; } // أول مرة: رفع بيانات هذا الجهاز
      const touched = new Set();
      snap.docChanges().forEach(ch => {
        if (ch.doc.metadata.hasPendingWrites) return;
        const d = ch.doc.data(); if (!STORES[d.store]) return;
        touched.add(d.store);
        if (ch.type === 'removed') delete sent[ch.doc.id]; else sent[ch.doc.id] = d.v;
      });
      touched.forEach(rebuild);
      if (touched.size) {
        try {
          renderDashboardStats(); renderAuditLog(); applyRolePermissions();
          const a = document.activeElement;
          if (!(a && /INPUT|SELECT|TEXTAREA/.test(a.tagName) && $('section-employees').contains(a))) renderEmployeeData();
        } catch (e) { console.error(e); }
      }
    }, e => console.error(e)));
    if (me.role === 'level1') unsubs.push(db.collection('users').onSnapshot(s => {
      usersCache = s.docs.map(d => ({ uid: d.id, ...d.data() })); window.renderSystemUsersTable();
    }));
  }

  // ====== 4) الدخول والخروج وكلمات المرور ======
  window.handleLogin = async function () {
    const u = $('login-username').value, p = $('login-pass').value, err = $('login-error'); err.textContent = '';
    if (!u.trim() || !p) { err.textContent = 'أدخل اسم المستخدم وكلمة المرور'; return; }
    try { await auth.signInWithEmailAndPassword(toEmail(u), p); }
    catch (e) { console.error(e); err.textContent = 'اسم المستخدم أو كلمة المرور غير صحيحة (كود الخطأ: ' + e.code + ')'; }
  };
  auth.onAuthStateChanged(async user => {
    if (!user) { $('login-modal').classList.remove('hidden'); return; }
    try {
      const ref = db.collection('users').doc(user.uid); let snap = await ref.get();
      if (!snap.exists && user.email === ADMIN_EMAIL) {
        await ref.set({ username: 'admin', email: user.email, role: 'level1', disabled: false, createdAt: Date.now() }); snap = await ref.get();
      }
      if (!snap.exists || snap.data().disabled) { await auth.signOut(); $('login-error').textContent = 'هذا الحساب غير مفعّل، راجع مدير النظام'; return; }
      me = snap.data(); enter();
    } catch (e) { console.error(e); $('login-error').textContent = 'تعذر الاتصال بقاعدة البيانات'; }
  });
  function enter() {
    currentUserRole = me.role; currentUsername = me.username;
    $('login-modal').classList.add('hidden');
    applyRolePermissions();
    $('tab-btn-admin').classList.toggle('hidden', me.role !== 'level1');
    switchMainTab('dashboard');
    const box = document.querySelector('header').lastElementChild;
    if (!$('btn-my-pw')) box.insertAdjacentHTML('beforeend',
      `<button id="btn-my-pw" onclick="changeMyPassword()" class="bg-slate-600 hover:bg-slate-700 text-white font-bold px-3 py-2 rounded-lg text-xs shadow"><i class="fa-solid fa-key ml-1"></i> كلمة مروري</button>
       <button onclick="auth_logout()" class="bg-red-700 hover:bg-red-800 text-white font-bold px-3 py-2 rounded-lg text-xs shadow"><i class="fa-solid fa-right-from-bracket ml-1"></i> خروج (${esc(me.username)})</button>`);
    startSync();
    logAuditAction(`تسجيل دخول ناجح (${me.username})`);
  }
  window.auth_logout = async () => { await auth.signOut(); location.reload(); };
  async function changePw(p) {
    if (!p || p.length < 6) { alert('كلمة المرور لا تقل عن 6 أحرف'); return; }
    try { await auth.currentUser.updatePassword(p); alert('تم تغيير كلمة المرور بنجاح'); logAuditAction('تغيير كلمة المرور الشخصية'); }
    catch (e) { alert(e.code === 'auth/requires-recent-login' ? 'سجّل الخروج ثم ادخل من جديد وأعد المحاولة' : 'تعذر تغيير كلمة المرور'); }
  }
  window.changeMyPassword = () => changePw(prompt('أدخل كلمة المرور الجديدة (6 أحرف على الأقل):'));
  window.updatePasswordFromAdminPage = () => { changePw($('admin-new-pass').value); $('admin-new-pass').value = ''; };

  // ====== 5) إدارة حسابات الموظفين (مدير النظام) ======
  window.renderSystemUsersTable = function () {
    const tb = $('system-users-tbody'); if (!tb) return;
    tb.closest('table').querySelector('thead tr').innerHTML = ['اسم المستخدم', 'مستوى الدخول', 'الحالة', 'إجراءات']
      .map(t => `<th class="p-2.5 border border-indigo-700">${t}</th>`).join('');
    tb.innerHTML = usersCache.map(u => {
      const self = auth.currentUser && u.uid === auth.currentUser.uid, r = (rolesPermissions[u.role] || {}).name || u.role;
      return `<tr class="border-b border-slate-200 dark:border-blue-900">
        <td class="p-2.5 font-bold">${esc(u.username)}</td><td class="p-2.5 text-blue-600 dark:text-yellow-300 font-bold">${esc(r)}</td>
        <td class="p-2.5 font-bold ${u.disabled ? 'text-red-600' : 'text-emerald-600'}">${u.disabled ? 'معطّل' : 'مفعّل'}</td>
        <td class="p-2.5 text-center">${self ? '-' : `<button onclick="toggleUser('${u.uid}')" class="bg-amber-600 text-white px-2 py-1 rounded text-[11px] ml-1">${u.disabled ? 'تفعيل' : 'تعطيل'}</button>
        <button onclick="resetUserPw('${u.uid}')" class="bg-blue-600 text-white px-2 py-1 rounded text-[11px]">رابط تغيير كلمة المرور</button>`}</td></tr>`;
    }).join('');
  };
  window.saveSystemUser = async function () {
    const name = $('new-user-name').value.trim(), pass = $('new-user-pass').value.trim(), role = $('new-user-role').value;
    if (!name || pass.length < 6) { alert('أدخل اسم المستخدم وكلمة مرور لا تقل عن 6 أحرف'); return; }
    if (!name.includes('@') && !/^[a-z0-9._-]+$/i.test(name)) { alert('اسم المستخدم بحروف إنجليزية وأرقام فقط (مثال: mohamed.hr) أو بريد إلكتروني'); return; }
    const email = toEmail(name);
    try {
      const sec = firebase.apps.find(a => a.name === 'sec') || firebase.initializeApp(firebaseConfig, 'sec');
      const c = await sec.auth().createUserWithEmailAndPassword(email, pass);
      await db.collection('users').doc(c.user.uid).set({ username: name, email, role, disabled: false, createdAt: Date.now() });
      await sec.auth().signOut();
      $('new-user-name').value = ''; $('new-user-pass').value = '';
      alert('تم إنشاء الحساب بنجاح'); logAuditAction(`إنشاء حساب (${name}) بمستوى (${role})`);
    } catch (e) { alert(e.code === 'auth/email-already-in-use' ? 'اسم المستخدم موجود بالفعل' : 'تعذر إنشاء الحساب: ' + e.code); }
  };
  window.toggleUser = async uid => {
    const u = usersCache.find(x => x.uid === uid);
    await db.collection('users').doc(uid).update({ disabled: !u.disabled });
    logAuditAction(`${u.disabled ? 'تفعيل' : 'تعطيل'} حساب (${u.username})`);
  };
  window.resetUserPw = async uid => {
    const u = usersCache.find(x => x.uid === uid);
    if (u.email.endsWith(DOMAIN)) { alert('هذا حساب ببريد افتراضي، لا يستقبل رسائل.\nلتغيير كلمة مروره: عطّله وأنشئ حساباً جديداً، أو يغيرها صاحب الحساب بنفسه من زر "كلمة مروري".'); return; }
    await auth.sendPasswordResetEmail(u.email); alert('تم إرسال رابط تغيير كلمة المرور إلى ' + u.email);
  };
  window.deleteSystemUser = () => alert('لحذف الحساب نهائياً استخدم Firebase Console؛ من هنا يمكنك تعطيله.');

  // ====== 6) المساعد الذكي: إجابات تفصيلية من قاعدة البيانات ======
  const norm = s => String(s || '').toLowerCase().replace(/[\u064B-\u0652ـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim();
  const STOP = new Set(['كم', 'عدد', 'ما', 'هو', 'هي', 'اسماء', 'اسم', 'موظف', 'موظفين', 'الموظفين', 'موظفي', 'مكتب', 'فرع', 'في', 'من', 'هل', 'لي', 'اعرض', 'اظهر', 'قائمة', 'كل', 'الكل', 'مؤسسة', 'شركة', 'المؤمن', 'عليهم', 'عليه', 'غير', 'الغير', 'مؤمن', 'متطوع', 'متطوعين', 'المتطوعين', 'تفاصيل', 'بالتفصيل', 'اجمالي', 'المؤسسة', 'عن', 'مين', 'هم', 'اللي', 'فى'].map(norm));
  const ENT = { 'شركة ماجيك': 'ماجيك', 'شركة ريسك': 'ريسك', 'شركة التحصيل': 'التحصيل', 'شركة الصحراء الغربية': 'الصحراء', 'مؤسسة إكرام (المزرعة)': 'مزرعة', 'مؤسسة إكرام': 'إكرام' };
  const CT = ['مؤمن عليه', 'الغير مؤمن عليهم', 'المتطوعين'];

  function group(list, multiEnt) {
    const line = e => `• ${esc(e.name)} — بصمة ${e.id} — ${esc(e.job || 'وظيفة غير محددة')}${multiEnt ? ' — ' + esc(e.entity) : ''}${e.resigned === 'ترك العمل' ? ' <b class="text-red-600">(ترك العمل)</b>' : ''}`;
    const cols = ['text-emerald-700', 'text-rose-700', 'text-amber-700'], tit = ['المؤمن عليهم', 'غير المؤمن عليهم', 'المتطوعون'];
    return CT.map((c, i) => { const a = list.filter(e => e.contractType === c); return `<br><b class="${cols[i]}">${i + 1}. ${tit[i]} (${a.length}):</b><br>${a.length ? a.map(line).join('<br>') : 'لا يوجد'}`; }).join('');
  }
  function aiAnswer(raw) {
    const q = norm(raw);
    const ents = Object.keys(ENT).filter(e => q.includes(norm(ENT[e])));
    if (ents.length > 1 && ents.includes('مؤسسة إكرام')) ents.splice(ents.indexOf('مؤسسة إكرام'), 1);
    const offs = allOffices.filter(o => { const n = norm(o); return q.includes(n) || n.split(/[\s/]+/).filter(w => w.length >= 4 && !['الفرع', 'الرئيسي'].includes(w)).some(w => q.includes(w)); });
    const ct = q.includes('غير مؤمن') ? CT[1] : q.includes('متطوع') ? CT[2] : q.includes('مؤمن') ? CT[0] : null;
    let scope = employees.filter(e => !ents.length || ents.includes(e.entity));
    const multi = new Set(scope.map(e => e.entity)).size > 1;
    const ctTxt = list => ct ? list.filter(e => e.contractType === ct) : list;
    const summary = l => `الإجمالي <b>${l.length}</b> — مؤمن عليهم ${l.filter(e => e.contractType === CT[0]).length} | غير مؤمن عليهم ${l.filter(e => e.contractType === CT[1]).length} | متطوعون ${l.filter(e => e.contractType === CT[2]).length}`;
    const show = l => ct ? `<br>${l.length ? l.map(e => `• ${esc(e.name)} — بصمة ${e.id} — ${esc(e.job || '-')}`).join('<br>') : 'لا يوجد'}` : group(l, multi);

    if (offs.length) return offs.map(o => { const l = scope.filter(e => e.department === o), f = ctTxt(l); return `<b>فرع ${esc(o)}:</b> ${summary(l)}${ct ? `<br><b>المطلوب (${esc(ct)}): ${f.length}</b>` : ''}${show(f)}`; }).join('<hr class="my-2">');

    const toks = q.split(' ').filter(t => t.length >= 2 && !STOP.has(t) && !Object.values(ENT).some(k => norm(k) === t));
    if (toks.length) {
      const found = employees.filter(e => toks.every(t => norm(e.name).includes(t) || String(e.id) === t));
      if (found.length) {
        const seeSal = (rolesPermissions[currentUserRole] || {}).editSal;
        return found.slice(0, 10).map(e => `<b>${esc(e.name)}</b><br>بصمة: ${e.id} | ${esc(e.entity)} | فرع: ${esc(e.department || '-')}<br>الوظيفة: ${esc(e.job || '-')} | التعاقد: ${esc(e.contractType || '-')}${e.resigned === 'ترك العمل' ? ' | <b class="text-red-600">ترك العمل</b>' : ''}<br>التعيين: ${esc(e.hireDate || '-')} | الهاتف: ${esc(e.phone || '-')} | انتهاء البطاقة: ${esc(e.idExpiry || '-')}${seeSal ? `<br>الراتب: ${esc(e.salary)} ج.م` : ''}`).join('<hr class="my-2">');
      }
    }
    if (ents.length || ct || /اسماء|قائمه|اعرض|اظهر/.test(q)) return `<b>${ents.length ? esc(ents.join(' + ')) : 'كل المؤسسات'}:</b> ${summary(scope)}${show(ctTxt(scope))}`;
    if (/عدد|كم|اجمالي|الموظفين|المؤسسه/.test(q)) {
      const per = Object.keys(ENT).map(e => `• ${e}: ${employees.filter(x => x.entity === e).length}`).join('<br>');
      return `<b>${summary(employees)}</b><br><br>${per}<br><br>اكتب اسم أي مكتب (مثل "بنها" أو "لوران") لأعرض لك أسماء موظفيه ونوع تأمين كل واحد.`;
    }
    return 'اسألني مثلاً: "كم عدد موظفي مكتب بنها؟" أو "أسماء المتطوعين في الأقصر" أو اكتب اسم موظف لأعرض بياناته.';
  }
  window.sendAiPrompt = function () {
    const input = $('ai-prompt-input'), box = $('ai-chat-box'), raw = input.value.trim(); if (!raw) return;
    box.innerHTML += `<div class="bg-blue-600 text-white p-2 rounded-lg text-left max-w-[85%] mr-auto font-semibold mb-2"><b>أنت:</b> ${esc(raw)}</div>`;
    input.value = '';
    box.innerHTML += `<div class="bg-emerald-100 dark:bg-emerald-950/80 text-emerald-900 dark:text-emerald-200 p-2.5 rounded-lg text-right max-w-[85%] ml-auto font-semibold border border-emerald-300 dark:border-emerald-700 mb-2 flex items-start gap-2"><img src="${aiCustomAvatar}" class="w-6 h-6 rounded-full object-cover"><div><b>المساعد الذكي:</b><br>${aiAnswer(raw)}</div></div>`;
    box.scrollTop = box.scrollHeight;
  };
})();
