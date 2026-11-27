(function(root){
  'use strict';
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function host(){if(typeof root.modal!=='function')throw new Error('Интерфейс Inkly ещё загружается.');}
  function redirectUrl(){return root.location.origin+root.location.pathname}
  function render(message){
    host();
    root.InklyAuth.loadSession().then(async function(session){
      var user=session?await root.InklyAuth.currentUser().catch(function(){return null}):null;
      if(user){
        root.modal('<div class="dialog-head"><h2>Аккаунт Inkly</h2><button class="close" type="button" onclick="closeModal()">×</button></div><p>Вы вошли как <strong>'+esc(user.email||'')}</strong>.</p><div id="inkly-account-status" class="muted">'+esc(message||'Проверка облачной библиотеки доступна после входа.')+'</div><div class="actions"><button class="btn" type="button" id="inkly-sync-now">Проверить синхронизацию</button><button class="btn light" type="button" id="inkly-signout">Выйти</button></div><p class="muted">На сервер передаётся только зашифрованная копия. Пароль, ключ восстановления и заметки в открытом виде не отправляются.</p>');
        document.getElementById('inkly-sync-now').onclick=syncNow;
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
              password=null;
              if(result&&result.access_token){status.textContent='Аккаунт создан. Проверяем локальную библиотеку…';await afterLogin()}
              else status.textContent='Письмо с подтверждением отправлено, если адрес допустим. Откройте ссылку из письма, вернитесь в Inkly и войдите с тем же паролем.';
            }else{
              await root.InklyAuth.signIn(email,password);password=null;await afterLogin();
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
  async function afterLogin(){
    var user=await root.InklyAuth.currentUser();
    if(!user)throw new Error('Сервер не подтвердил вход.');
    if(root.vaultRuntime&&root.vaultRuntime.getStatus()==='unlocked'){
      var passwordField=document.getElementById('inkly-password');
      var password=passwordField?passwordField.value:'';
      // Login form clears the password only after this verification step.
      if(password&&root.vaultRuntime.verifyPassword)await root.vaultRuntime.verifyPassword(password);
    }
    root.closeModal();
    render('Аккаунт подключён. Проверяем наличие облачной копии…');
    await syncNow();
  }
  async function syncNow(){
    var status=document.getElementById('inkly-account-status');
    if(status)status.textContent='Проверяем облачную библиотеку…';
    try{
      var remote=await root.InklyCloudSync.read();
      if(remote){
        if(status)status.textContent='В облаке уже есть зашифрованная библиотека (версия '+remote.revision+'). Автоматическая перезапись отключена. Сначала нужно безопасно сравнить и выбрать копию.';
        return;
      }
      if(!root.vaultRuntime||root.vaultRuntime.getStatus()!=='unlocked')throw new Error('Сначала разблокируйте локальную библиотеку.');
      var envelope=await root.vaultRuntime.exportEncryptedEnvelope();
      var saved=await root.InklyCloudSync.upload(envelope,null);
      if(status)status.textContent='Первая зашифрованная копия сохранена в облаке. Версия '+saved.revision+'.';
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
  async function handleCallback(){
    try{
      var callback=await root.InklyAuth.handleAuthCallback();
      if(callback&&callback.type==='recovery'){
        root.modal('<div class="dialog-head"><h2>Сброс пароля аккаунта</h2></div><p>Ссылка подтверждена. Задайте новый пароль аккаунта. Затем потребуется ключ восстановления библиотеки: пароль из письма не расшифровывает ваши книги и заметки.</p><form id="inkly-reset-form"><div class="field"><label>Новый пароль аккаунта</label><input id="inkly-reset-password" type="password" minlength="12" autocomplete="new-password" required></div><button class="btn" type="submit">Изменить пароль</button></form><p id="inkly-reset-status" class="muted" role="status"></p>');
        document.getElementById('inkly-reset-form').onsubmit=async function(e){e.preventDefault();var p=document.getElementById('inkly-reset-password').value;try{await root.InklyAuth.updatePassword(p);p=null;document.getElementById('inkly-reset-status').textContent='Пароль аккаунта изменён. Чтобы снова синхронизировать библиотеку, войдите с новым паролем и выполните восстановление её парольной защиты с ключом восстановления.'}catch(err){p=null;document.getElementById('inkly-reset-status').textContent=err.message||'Не удалось изменить пароль.'}};
      }else if(callback){render('Почта подтверждена. Теперь войдите в аккаунт Inkly.')}
    }catch(e){if(root.console)console.warn('Inkly auth callback:',e)}
  }
  root.InklyAccountUI=Object.freeze({open:render,handleCallback:handleCallback});
  if(root.document)root.document.addEventListener('DOMContentLoaded',handleCallback);
})(typeof globalThis!=='undefined'?globalThis:this);
