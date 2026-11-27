(function(root){
  'use strict';
  var vaultVerified=false;
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function host(){if(typeof root.modal!=='function')throw new Error('Интерфейс Inkly ещё загружается.');}
  function redirectUrl(){return root.location.origin+root.location.pathname}
  function render(message){
    host();
    return root.InklyAuth.loadSession().then(async function(session){
      var user=session?await root.InklyAuth.currentUser().catch(function(){return null}):null;
      if(user){
        root.modal('<div class="dialog-head"><h2>Аккаунт Inkly</h2><button class="close" type="button" onclick="closeModal()">×</button></div><p>Вы вошли как <strong>'+esc(user.email||'')+'</strong>.</p><div id="inkly-account-status" class="muted">'+esc(message||'Проверка облачной библиотеки доступна после входа.')+'</div><div class="field"><label for="inkly-vault-password">Пароль защищённой библиотеки для подтверждения синхронизации</label><input id="inkly-vault-password" type="password" autocomplete="current-password"></div><div class="actions"><button class="btn" type="button" id="inkly-verify-sync">Подтвердить пароль и синхронизировать</button><button class="btn light" type="button" id="inkly-sync-now">Проверить синхронизацию</button><button class="btn light" type="button" id="inkly-signout">Выйти</button></div><p class="muted">На сервер передаётся только зашифрованная копия. Пароль, ключ восстановления и заметки в открытом виде не отправляются.</p>');
        document.getElementById('inkly-sync-now').onclick=syncNow;
        document.getElementById('inkly-verify-sync').onclick=verifyAndSync;
        document.getElementById('inkly-signout').onclick=signOut;
      }else{
        root.modal('<div class="dialog-head"><h2>Аккаунт Inkly</h2><button class="close" type="button" onclick="closeModal()">×</button></div><div class="tabs"><button type="button" id="inkly-tab-login" class="active">Войти</button><button type="button" id="inkly-tab-signup">Регистрация</button></div><form id="inkly-auth-form"><div class="field"><label for="inkly-email">Электронная почта</label><input id="inkly-email" type="email" autocomplete="email" required></div><div class="field"><label for="inkly-password">Пароль</label><input id="inkly-password" type="password" minlength="12" autocomplete="current-password" required></div><div class="field" id="inkly-repeat-wrap" hidden><label for="inkly-password-repeat">Повторите пароль</label><input id="inkly-password-repeat" type="password" minlength="12" autocomplete="new-password"></div><button class="btn" type="submit" id="inkly-auth-submit">Войти</button></form><button class="btn ghost small" type="button" id="inkly-forgot">Забыли пароль?</button><p id="inkly-auth-status" class="muted" role="status">'+esc(message||'Пароль аккаунта должен совпадать с паролем защищённой библиотеки, чтобы связать её с облаком.')+'</p><p class="muted">Минимум 12 символов. Подтверждение регистрации придёт на почту. Сброс пароля аккаунта сам по себе не расшифровывает библиотеку.</p>');
        var mode='login',form=document.getElementById('inkly-auth-form');
        function setMode(next){
          mode=next;
          document.getElementById('inkly-tab-login').classList.toggle('active',mode==='login');
          document.getElementById('inkly-tab-signup').classList.toggle('active',mode==='signup');
          document.getElementById('inkly-repeat-wrap').hidden=mode!=='signup';
          document.getElementById('inkly-password').autocomplete=mode==='signup'?'new-password':'current-password';
          document.getElementById('inkly-auth-submit').textContent=mode==='signup'?'Создать аккаунт':'Войти';
        }
        document.getElementById('inkly-tab-login').onclick=function(){setMode('login')};
        document.getElementById('inkly-tab-signup').onclick=function(){setMode('signup')};
        form.onsubmit=async function(e){
          e.preventDefault();var email=document.getElementById('inkly-email').value.trim(),password=document.getElementById('inkly-password').value,status=document.getElementById('inkly-auth-status');
          if(password.length<12){status.textContent='Используйте пароль не короче 12 символов.';return}
          if(mode==='signup'&&password!==document.getElementById('inkly-password-repeat').value){status.textContent='Пароли не совпадают.';return}
          status.textContent='Выполняется запрос…';
          try{
            if(mode==='signup'){
              var result=await root.InklyAuth.signUp(email,password,redirectUrl());
              if(result&&result.access_token){status.textContent='Аккаунт создан. Проверяем локальную библиотеку…';await afterLogin(password);password=null}
              else status.textContent='Письмо с подтверждением отправлено, если адрес допустим. Откройте ссылку из письма, вернитесь в Inkly и войдите с тем же паролем.';
            }else{
              await root.InklyAuth.signIn(email,password);await afterLogin(password);password=null;
            }
          }catch(err){password=null;status.textContent=err&&err.message||'Не удалось выполнить запрос.'}
        };
        document.getElementById('inkly-forgot').onclick=async function(){
          var email=document.getElementById('inkly-email').value.trim(),status=document.getElementById('inkly-auth-status');
          if(!email){status.textContent='Сначала укажите электронную почту.';return}
          try{await root.InklyAuth.sendPasswordReset(email,redirectUrl());status.textContent='Если адрес зарегистрирован, на него придёт письмо для сброса пароля. После сброса для доступа к зашифрованной библиотеке потребуется ключ восстановления.'}
          catch(err){status.textContent=err.message||'Не удалось отправить письмо.'}
        };
      }
    }).catch(function(err){root.modal('<div class="dialog-head"><h2>Аккаунт Inkly</h2><button class="close" onclick="closeModal()">×</button></div><p class="vault-error">'+esc(err.message||String(err))+'</p>')});
  }
  async function afterLogin(password){
    var user=await root.InklyAuth.currentUser();
    if(!user)throw new Error('Сервер не подтвердил вход.');
    if(root.vaultRuntime&&root.vaultRuntime.getStatus()==='unlocked'){
      if(!password||!root.vaultRuntime.verifyPassword)throw new Error('Для привязки аккаунта разблокируйте библиотеку и введите тот же пароль, которым она защищена.');
      await root.vaultRuntime.verifyPassword(password);vaultVerified=true;
    }
    root.closeModal();
    await render('Аккаунт подключён. Проверяем наличие облачной копии…');
    await syncNow();
  }
  async function verifyAndSync(){
    var field=document.getElementById('inkly-vault-password'),status=document.getElementById('inkly-account-status'),password=field&&field.value||'';
    try{
      if(!root.vaultRuntime||root.vaultRuntime.getStatus()!=='unlocked')throw new Error('Сначала разблокируйте локальную библиотеку.');
      await root.vaultRuntime.verifyPassword(password);vaultVerified=true;
      if(field)field.value='';
      await syncNow();
    }catch(err){if(status)status.textContent=err.message||'Не удалось подтвердить пароль библиотеки.'}
    password=null;
  }
  async function syncNow(){
    var status=document.getElementById('inkly-account-status');
    if(!vaultVerified){if(status)status.textContent='Перед первой синхронизацией подтвердите пароль локальной библиотеки. Он должен совпадать с паролем аккаунта.';return}
    if(status)status.textContent='Проверяем облачную библиотеку…';
    try{
      if(!root.vaultRuntime||root.vaultRuntime.getStatus()!=='unlocked')throw new Error('Сначала разблокируйте локальную библиотеку.');
      var result=await root.InklyCloudSync.sync(root.vaultRuntime);
      if(status)status.textContent=result.status==='synced'?'Синхронизация завершена. Облачная версия: '+result.revision+'.':'Библиотека сохранена локально; для синхронизации разблокируйте её.';
    }catch(err){if(status)status.textContent=err.message||'Синхронизация не выполнена.'}
  }
  async function signOut(){
    try{
      await root.InklyAuth.signOut();
      if(root.InklyVaultUI)await root.InklyVaultUI.lock();
      root.closeModal();
      if(typeof root.toast==='function')root.toast('Вы вышли из аккаунта Inkly. Локальная зашифрованная библиотека сохранена.');
    }catch(err){var status=document.getElementById('inkly-account-status');if(status)status.textContent=err.message||'Не удалось завершить выход.'}
  }
  async function restoreFromCloud(){
    host();
    root.modal('<div class="dialog-head"><h2>Восстановить библиотеку</h2><button class="close" type="button" onclick="closeModal()">×</button></div><p>Войдите в аккаунт, в котором хранится зашифрованная библиотека. Для расшифровки используйте пароль библиотеки или ключ восстановления.</p><form id="inkly-restore-form"><div class="field"><label>Электронная почта аккаунта</label><input id="inkly-restore-email" type="email" autocomplete="email" required></div><div class="field"><label>Пароль аккаунта</label><input id="inkly-restore-password" type="password" autocomplete="current-password" required></div><div class="field"><label>Ключ восстановления библиотеки (если пароль библиотеки отличается от пароля аккаунта)</label><input id="inkly-restore-recovery" type="password" autocomplete="off"></div><button class="btn" type="submit">Войти и восстановить</button></form><p id="inkly-restore-status" class="muted" role="status"></p>');
    document.getElementById('inkly-restore-form').onsubmit=async function(e){
      e.preventDefault();var email=document.getElementById('inkly-restore-email').value.trim(),password=document.getElementById('inkly-restore-password').value,recovery=document.getElementById('inkly-restore-recovery').value.trim(),status=document.getElementById('inkly-restore-status');
      status.textContent='Входим в аккаунт и ищем облачную копию…';
      try{
        await root.InklyAuth.signIn(email,password);
        var remote=await root.InklyCloudSync.read();
        if(!remote)throw new Error('Для этого аккаунта пока нет облачной библиотеки.');
        try{await root.vaultRuntime.installEncryptedEnvelope(remote.envelope,password,'password')}
        catch(passwordError){if(!recovery)throw new Error('Пароль аккаунта не открыл библиотеку. Введите ключ восстановления.');await root.vaultRuntime.installEncryptedEnvelope(remote.envelope,recovery,'recovery')}
        await root.InklyCloudSync.adoptRemote(remote);
        password=null;recovery=null;status.textContent='Зашифрованная библиотека восстановлена. Перезапускаем Inkly…';
        root.setTimeout(function(){root.location.reload()},700);
      }catch(err){password=null;recovery=null;status.textContent=err.message||'Не удалось восстановить библиотеку. Локальные данные не были заменены.'}
    };
  }
  async function handleCallback(){
    try{
      var callback=await root.InklyAuth.handleAuthCallback();
      if(callback&&callback.type==='recovery'){
        root.modal('<div class="dialog-head"><h2>Сброс пароля аккаунта</h2></div><p>Ссылка подтверждена. Задайте новый пароль аккаунта. Затем потребуется ключ восстановления библиотеки: пароль из письма не расшифровывает ваши книги и заметки.</p><form id="inkly-reset-form"><div class="field"><label>Новый пароль аккаунта (не менее 12 символов)</label><input id="inkly-reset-password" type="password" minlength="12" autocomplete="new-password" required></div><div class="field"><label>Ключ восстановления библиотеки</label><input id="inkly-reset-recovery" type="password" autocomplete="off" required></div><button class="btn" type="submit">Изменить пароль и защиту библиотеки</button></form><p id="inkly-reset-status" class="muted" role="status"></p>');
        document.getElementById('inkly-reset-form').onsubmit=async function(e){e.preventDefault();var p=document.getElementById('inkly-reset-password').value;try{await root.InklyAuth.updatePassword(p);var recovery=document.getElementById('inkly-reset-recovery').value.trim();if(!recovery)throw new Error('Пароль аккаунта изменён. Введите ключ восстановления библиотеки, чтобы обновить её парольную защиту.');if(!root.vaultRuntime||!root.vaultRuntime.recoverPasswordWrap)throw new Error('Пароль аккаунта изменён. Обновление локальной защиты пока недоступно; сохраните ключ восстановления.');await root.vaultRuntime.recoverPasswordWrap(recovery,p);p=null;document.getElementById('inkly-reset-status').textContent='Пароль аккаунта и парольная защита библиотеки обновлены. Сохраните ключ восстановления в надёжном месте.'}catch(err){p=null;document.getElementById('inkly-reset-status').textContent=err.message||'Не удалось изменить пароль.'}};
      }else if(callback){render('Почта подтверждена. Теперь войдите в аккаунт Inkly.')}
    }catch(e){if(root.console)console.warn('Inkly auth callback:',e)}
  }
  root.InklyAccountUI=Object.freeze({open:render,handleCallback:handleCallback,restoreFromCloud:restoreFromCloud,isVerified:function(){return vaultVerified;}});
  if(root.document)root.document.addEventListener('DOMContentLoaded',handleCallback);
})(typeof globalThis!=='undefined'?globalThis:this);
