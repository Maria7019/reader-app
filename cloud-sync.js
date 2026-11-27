(function(root){
  'use strict';
  var config=root.INKLY_SUPABASE_CONFIG;
  function ensure(){if(!config||!config.url||!config.publishableKey)throw new Error('Подключение Supabase не настроено.')}
  async function call(path,options){
    ensure();options=options||{};var token=await root.InklyAuth.accessToken();
    if(!token)throw new Error('Сначала войдите в аккаунт Inkly.');
    var headers=new Headers(options.headers||{});
    headers.set('apikey',config.publishableKey);headers.set('Authorization','Bearer '+token);headers.set('Accept','application/json');
    if(options.body!==undefined){headers.set('Content-Type','application/json');options.body=JSON.stringify(options.body)}
    var response=await fetch(config.url+'/rest/v1/'+path,Object.assign({},options,{headers:headers,credentials:'omit',cache:'no-store'}));
    var text=await response.text(),payload=null;
    try{payload=text?JSON.parse(text):null}catch(e){throw new Error('Сервер синхронизации вернул некорректный ответ.')}
    if(!response.ok){if(response.status===409||response.status===412)throw new Error('Обнаружен конфликт версии облачной библиотеки. Данные не перезаписаны.');throw new Error(payload&& (payload.message||payload.details)||'Синхронизация не выполнена.')}
    return payload;
  }
  function validateEnvelope(envelope){
    if(!envelope||typeof envelope!=='object'||Array.isArray(envelope)||envelope.format!=='inkly-encrypted-v1'||envelope.version!==1||envelope.cipher!=='AES-256-GCM'||!envelope.passwordWrap||envelope.deviceWrap)throw new Error('Для облачной синхронизации требуется корректная копия библиотеки с парольной защитой.');
    root.InklySecurityCore.validateRecord(envelope);
  }
  async function read(){
    var user=await root.InklyAuth.currentUser();if(!user)throw new Error('Сначала войдите в аккаунт Inkly.');
    var rows=await call('vault_sync?select=envelope,revision,updated_at&user_id=eq.'+encodeURIComponent(user.id),{method:'GET'});
    return rows&&rows.length?rows[0]:null;
  }
  async function upload(envelope,expectedRevision){
    validateEnvelope(envelope);
    var user=await root.InklyAuth.currentUser();if(!user)throw new Error('Сначала войдите в аккаунт Inkly.');
    if(expectedRevision===null||expectedRevision===undefined){
      try{
        var inserted=await call('vault_sync?select=revision,updated_at',{method:'POST',headers:{Prefer:'return=representation'},body:{user_id:user.id,envelope:envelope}});
        if(!inserted||inserted.length!==1)throw new Error('Сервер не подтвердил сохранение облачной копии.');
        return inserted[0];
      }catch(e){if(/duplicate|already exists|conflict|23505|409/i.test(e.message))throw new Error('В облаке уже есть библиотека. Inkly не стала её перезаписывать.');throw e}
    }
    var updated=await call('vault_sync?user_id=eq.'+encodeURIComponent(user.id)+'&revision=eq.'+encodeURIComponent(String(expectedRevision))+'&select=revision,updated_at',{method:'PATCH',headers:{Prefer:'return=representation'},body:{envelope:envelope}});
    if(!updated||updated.length!==1)throw new Error('Версия облачной библиотеки изменилась. Локальная копия сохранена, облачная не перезаписана.');
    return updated[0];
  }
  root.InklyCloudSync=Object.freeze({read:read,upload:upload,validateEnvelope:validateEnvelope});
})(typeof globalThis!=='undefined'?globalThis:this);
