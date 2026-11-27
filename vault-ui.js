(function(root){
  'use strict';
  var runtime=null,idleTimer=null,lastActivity=Date.now(),recoveryMode=false,callbacks={},sessionLockRelease=null;

  function screen(markup){
    document.body.classList.add('vault-locked');
    var modal=document.getElementById('modal-root');if(modal)modal.innerHTML='';
    var view=document.getElementById('view');
    if(view)view.innerHTML='<section class="vault-screen">'+markup+'</section>';
  }
  function error(message){
    var old=document.getElementById('vault-error');if(old)old.remove();
    var node=document.createElement('p');node.id='vault-error';node.className='vault-error';node.textContent=message;
    var host=document.querySelector('.vault-screen');if(host)host.appendChild(node);
  }

  function acquireSessionLock(){
    if(sessionLockRelease)return Promise.resolve(true);
    if(!navigator.locks||typeof navigator.locks.request!=='function')return Promise.resolve(true);
    return new Promise(function(resolve){
      var settled=false;
      navigator.locks.request('inkly-vault-session',{mode:'exclusive',ifAvailable:true},async function(lock){
        if(!lock){settled=true;resolve(false);return}
        var release;
        var hold=new Promise(function(done){release=done});
        sessionLockRelease=release;
        settled=true;resolve(true);
        await hold;
      }).catch(function(){if(!settled)resolve(false)});
    });
  }
  function releaseSessionLock(){
    if(!sessionLockRelease)return;
    var release=sessionLockRelease;sessionLockRelease=null;release();
  }

  function activate(data){
    callbacks.initialData=null;callbacks.legacyRaw=null;
    document.body.classList.remove('vault-locked');
    if(typeof callbacks.onUnlock==='function')callbacks.onUnlock(data);
    armLock();
  }
  function showSetup(data){
    var legacy=!!data;
    screen('<h1>Защита библиотеки Inkly</h1><p>'+(legacy?'Найдена библиотека прежнего формата. Она будет перенесена в зашифрованное хранилище. Исходная запись останется нетронутой до успешной проверки.':'Создайте пароль для своей библиотеки. Записи будут храниться в зашифрованном виде на этом устройстве.')+'</p><form id="vault-setup-form"><div class="field"><label>Новый пароль (не менее 12 символов)</label><input id="vault-password" type="password" minlength="12" autocomplete="new-password" required></div><div class="field"><label>Повторите пароль</label><input id="vault-password-repeat" type="password" minlength="12" autocomplete="new-password" required></div><button class="btn" type="submit">Создать защищённую библиотеку</button></form>${legacy?'':'<button class="btn light" type="button" onclick="InklyAccountUI.restoreFromCloud()">У меня уже есть аккаунт — восстановить библиотеку</button>'}<p class="muted">Пароль не отправляется на сервер и не сохраняется в открытом виде. Не используйте пароль, который уже применяете на других сайтах. Открывайте библиотеку в одной вкладке; современные браузеры дополнительно блокируют параллельный сеанс.</p>');
    document.getElementById('vault-setup-form').onsubmit=async function(e){
      e.preventDefault();
      var password=document.getElementById('vault-password').value;
      var repeated=document.getElementById('vault-password-repeat').value;
      if(password!==repeated){error('Пароли не совпадают.');return}
      try{
        var prepared=await runtime.prepareSetup(data||callbacks.initialData,password);
        screen('<h1>Ключ восстановления</h1><p>Сохраните этот ключ отдельно от телефона. Он позволит открыть библиотеку, если вы забудете основной пароль. Inkly покажет его только один раз.</p><div class="vault-code" id="vault-recovery-code"></div><div class="vault-actions"><button class="btn light" type="button" id="vault-copy-recovery">Скопировать ключ</button><button class="btn" type="button" id="vault-confirm-recovery">Я сохранила ключ</button></div><p class="muted">Не отправляйте ключ другим людям и не храните единственную копию внутри Inkly.</p>');
        var recovery=prepared.recoveryCode;
        document.getElementById('vault-recovery-code').textContent=recovery;
        document.getElementById('vault-copy-recovery').onclick=function(){
          if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(recovery).then(function(){if(typeof callbacks.onToast==='function')callbacks.onToast('Ключ скопирован')}).catch(function(){error('Не удалось скопировать автоматически. Выделите ключ и скопируйте его вручную.')});
          else error('Выделите ключ и скопируйте его вручную.');
        };
        document.getElementById('vault-confirm-recovery').onclick=async function(){
          try{
            if(!await acquireSessionLock())throw new Error('Inkly уже открыт в другой вкладке. Закройте её и повторите попытку.');
            await runtime.confirmSetup();
            var opened=await runtime.unlockWithPassword(password);
            password=null;recovery=null;
            if(legacy&&callbacks.onLegacyMigrated)callbacks.onLegacyMigrated();
            activate(opened);
          }catch(e){releaseSessionLock();error('Не удалось завершить настройку: '+(e.message||String(e)))}
        };
      }catch(e){error(e.message||String(e))}
    };
  }
  function showUnlock(message){
    recoveryMode=false;
    var metadata=runtime.getRecordMetadata();
    if(metadata&&metadata.method==='device'){
      screen('<h1>Библиотека заблокирована</h1><p>Защищённая библиотека найдена на этом устройстве.</p><p class="muted">Открывайте библиотеку в одной вкладке. Современные браузеры блокируют параллельный сеанс.</p><button class="btn" id="vault-device-unlock">Разблокировать</button>');
      document.getElementById('vault-device-unlock').onclick=async function(){try{if(!await acquireSessionLock())throw new Error('Inkly уже открыт в другой вкладке.');activate(await runtime.unlockWithDevice())}catch(e){releaseSessionLock();showUnlock(e.message||'Не удалось открыть библиотеку на этом устройстве.')}};return;
    }
    renderUnlock(message);
  }
  function renderUnlock(message){
    screen('<h1>Inkly заблокирован</h1><p>Введите пароль, чтобы открыть личную библиотеку.</p><p class="muted">Открывайте библиотеку в одной вкладке. Современные браузеры блокируют параллельный сеанс.</p>'+(message?'<p class="vault-error">'+String(message).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})+'</p>':'')+(recoveryMode?'<form id="vault-unlock-form"><div class="field"><label>Ключ восстановления</label><input id="vault-unlock-secret" type="text" autocomplete="off" required></div><button class="btn" type="submit">Восстановить доступ</button></form><button class="btn light" id="vault-back-password">Назад к паролю</button>':'<form id="vault-unlock-form"><div class="field"><label>Пароль</label><input id="vault-unlock-secret" type="password" autocomplete="current-password" required></div><button class="btn" type="submit">Разблокировать</button></form><button class="btn light" id="vault-use-recovery">Использовать ключ восстановления</button>'));
    document.getElementById('vault-unlock-form').onsubmit=async function(e){
      e.preventDefault();var secret=document.getElementById('vault-unlock-secret').value;
      try{if(!await acquireSessionLock())throw new Error('Inkly уже открыт в другой вкладке. Закройте её и повторите попытку.');var opened=recoveryMode?await runtime.unlockWithRecoveryCode(secret):await runtime.unlockWithPassword(secret);secret=null;if(callbacks.onLegacyMigrated)callbacks.onLegacyMigrated();activate(opened)}
      catch(err){releaseSessionLock();renderUnlock(err.message==='Inkly уже открыт в другой вкладке. Закройте её и повторите попытку.'?err.message:'Не удалось разблокировать библиотеку. Проверьте введённые данные.')}
    };
    var use=document.getElementById('vault-use-recovery'),back=document.getElementById('vault-back-password');
    if(use)use.onclick=function(){recoveryMode=true;renderUnlock()};
    if(back)back.onclick=function(){recoveryMode=false;renderUnlock()};
  }
  function armLock(){
    if(idleTimer)clearTimeout(idleTimer);
    lastActivity=Date.now();
    idleTimer=setTimeout(lock,5*60*1000);
  }
  async function lock(){
    if(!runtime||runtime.getStatus()!=='unlocked')return;
    try{
      await runtime.lock();
      if(idleTimer)clearTimeout(idleTimer);
      releaseSessionLock();
      if(typeof callbacks.onLock==='function')callbacks.onLock();
      showUnlock('Сеанс завершён после пяти минут бездействия.');
    }catch(e){if(typeof callbacks.onLockFailure==='function')callbacks.onLockFailure(e);else if(typeof callbacks.onError==='function')callbacks.onError(e)}
  }
  function activity(){
    if(!runtime||runtime.getStatus()!=='unlocked'||document.hidden)return;
    if(Date.now()-lastActivity>=5*60*1000){lock();return}
    armLock();
  }
  ['pointerdown','keydown','touchstart','scroll'].forEach(function(name){document.addEventListener(name,activity,{passive:true})});
  document.addEventListener('visibilitychange',function(){
    if(!runtime||runtime.getStatus()!=='unlocked')return;
    if(document.hidden){if(idleTimer)clearTimeout(idleTimer);idleTimer=setTimeout(lock,5*60*1000)}
    else if(Date.now()-lastActivity>=5*60*1000)lock();
    else armLock();
  });

  async function start(options){
    callbacks=options||{};
    runtime=root.InklyVaultRuntime.create();
    try{
      var result=await runtime.initialize(callbacks.legacyRaw);
      if(result.status==='setup-required'){showSetup(null);return}
      if(result.status==='migration-required'){showSetup(callbacks.initialData||result.legacyData);callbacks.legacyRaw=null;return}
      if(result.status==='locked'){callbacks.initialData=null;callbacks.legacyRaw=null;showUnlock();return}
      if(typeof callbacks.onError==='function')callbacks.onError(new Error('Неизвестное состояние защищённого хранилища.'));
    }catch(e){if(typeof callbacks.onError==='function')callbacks.onError(e)}
  }
  root.InklyVaultUI=Object.freeze({start:start,lock:lock,getRuntime:function(){return runtime}});
})(typeof globalThis!=='undefined'?globalThis:this);
