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
  var syncQueue=Promise.resolve();
  async function fingerprint(envelope){
    var bytes=new TextEncoder().encode(JSON.stringify(envelope));
    var digest=await crypto.subtle.digest('SHA-256',bytes);
    return Array.from(new Uint8Array(digest)).map(function(x){return x.toString(16).padStart(2,'0')}).join('');
  }
  async function adoptRemote(remote){
    if(!remote||!Number.isSafeInteger(Number(remote.revision))||Number(remote.revision)<1)throw new Error('Облачная запись имеет неверный формат.');
    validateEnvelope(remote.envelope);
    var hash=await fingerprint(remote.envelope);
    await root.InklyIndexedStore.writeSyncMeta({revision:Number(remote.revision),localHash:hash});
    return true;
  }
  function sync(runtime){
    var operation=syncQueue.then(async function(){
      if(!runtime||runtime.getStatus()!=='unlocked')return {status:'locked'};
      var envelope=await runtime.exportEncryptedEnvelope(),localHash=await fingerprint(envelope);
      var meta=await root.InklyIndexedStore.readSyncMeta();
      var remote=await read();
      if(!remote){
        if(meta)throw new Error('Облачная запись отсутствует, хотя на устройстве сохранена история синхронизации. Автоматическая повторная загрузка отключена.');
        var first=await upload(envelope,null);
        await root.InklyIndexedStore.writeSyncMeta({revision:Number(first.revision),localHash:localHash});
        return {status:'synced',revision:Number(first.revision),initial:true};
      }
      var remoteHash=await fingerprint(remote.envelope);
      if(remoteHash===localHash){
        await root.InklyIndexedStore.writeSyncMeta({revision:Number(remote.revision),localHash:localHash});
        return {status:'synced',revision:Number(remote.revision),unchanged:true};
      }
      if(!meta)throw new Error('В облаке уже есть другая библиотека. Inkly не будет перезаписывать её автоматически.');
      if(Number(remote.revision)!==Number(meta.revision))throw new Error('Облачная версия изменилась на другом устройстве. Локальная библиотека сохранена; требуется разрешить конфликт.');
      if(meta.localHash!==remoteHash)throw new Error('Облачная запись не совпадает с последней подтверждённой версией. Синхронизация остановлена для защиты данных.');
      var updated=await upload(envelope,Number(meta.revision));
      await root.InklyIndexedStore.writeSyncMeta({revision:Number(updated.revision),localHash:localHash});
      return {status:'synced',revision:Number(updated.revision),updated:true};
    });
    syncQueue=operation.catch(function(){});
    return operation;
  }
  root.InklyCloudSync=Object.freeze({read:read,upload:upload,sync:sync,adoptRemote:adoptRemote,validateEnvelope:validateEnvelope});
})(typeof globalThis!=='undefined'?globalThis:this);
