(function(root){
  'use strict';

  function cloneData(value){
    if(typeof structuredClone==='function')return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function createRuntime(options){
    options=options||{};
    var store=options.store||root.InklyIndexedStore;
    var crypto=options.crypto||root.InklySecurityCore;
    if(!store||!crypto)throw new Error('Модули защищённого хранилища Inkly не загружены.');

    var record=null,deviceKey=null,data=null,dek=null,status='new',writeQueue=Promise.resolve(),pendingSetup=null,lockRequested=false,writeError=null;

    function requireUnlocked(){
      if(status!=='unlocked'||!dek||!data)throw new Error('Сначала разблокируйте защищённую библиотеку.');
    }

    async function initialize(legacyRaw){
      if(status==='unlocked')throw new Error('Перед повторной инициализацией заблокируйте библиотеку.');
      var saved=await store.readVault();
      if(saved){
        record=saved.record;
        deviceKey=saved.deviceKey||null;
        data=null;dek=null;pendingSetup=null;
        status='locked';
        return {status:status,method:record.passwordWrap?'password':'device'};
      }
      record=null;deviceKey=null;data=null;dek=null;pendingSetup=null;
      if(typeof legacyRaw==='string'&&legacyRaw.length){
        var legacyData;
        try{legacyData=JSON.parse(legacyRaw)}catch(e){status='recovery-required';throw new Error('Старые записи Inkly не удалось прочитать. Исходные данные не изменены.')}
        if(!legacyData||typeof legacyData!=='object'||Array.isArray(legacyData)||!Array.isArray(legacyData.books)||!Array.isArray(legacyData.disciplines)){
          status='recovery-required';
          throw new Error('Формат старой библиотеки не прошёл проверку. Исходные данные не изменены.');
        }
        status='migration-required';
        return {status:status,legacyData:cloneData(legacyData)};
      }
      status='setup-required';
      return {status:status};
    }

    async function prepareSetup(initialData,password){
      if(status!=='setup-required'&&status!=='migration-required')throw new Error('Сейчас настройка защищённого хранилища недоступна.');
      if(pendingSetup)throw new Error('Предыдущая настройка ещё не завершена.');
      var created=await crypto.createVault(cloneData(initialData),password);
      pendingSetup={record:created.record,deviceKey:created.deviceKey||null};
      return {recoveryCode:created.recoveryCode,method:created.record.passwordWrap?'password':'device'};
    }

    async function confirmSetup(){
      if(!pendingSetup)throw new Error('Сначала подготовьте защищённое хранилище.');
      var candidate=pendingSetup;
      await store.writeVault(candidate.record,candidate.deviceKey);
      record=candidate.record;deviceKey=candidate.deviceKey;pendingSetup=null;
      status='locked';
      return {status:status};
    }

    function cancelSetup(){
      pendingSetup=null;
      return true;
    }

    async function activate(key){
      var opened=await crypto.decryptLibrary(record,key);
      dek=key;data=opened;status='unlocked';
      return cloneData(data);
    }

    async function unlockWithPassword(password){
      if(status!=='locked'||!record)throw new Error('Защищённая библиотека не готова к разблокировке.');
      return activate(await crypto.unlockWithPassword(record,password));
    }

    async function unlockWithRecoveryCode(code){
      if(status!=='locked'||!record)throw new Error('Защищённая библиотека не готова к восстановлению.');
      return activate(await crypto.unlockWithRecoveryCode(record,code));
    }

    async function unlockWithDevice(){
      if(status!=='locked'||!record||!deviceKey)throw new Error('Для этой библиотеки недоступен локальный ключ устройства.');
      return activate(await crypto.unlockWithDeviceKey(record,deviceKey));
    }

    function getData(){
      requireUnlocked();
      return data;
    }

    async function recoverPasswordWrap(recoveryCode,newPassword){
      if(!record)throw new Error('Защищённая библиотека ещё не создана.');
      var updated=await crypto.rewrapPasswordWithRecovery(record,recoveryCode,newPassword);
      await store.writeVault(updated,null);
      record=updated;deviceKey=null;
      return true;
    }

    async function verifyPassword(password){
      requireUnlocked();
      if(!record||!record.passwordWrap)throw new Error('Для синхронизации нужен парольный способ защиты библиотеки.');
      var key=await crypto.unlockWithPassword(record,password);
      await crypto.decryptLibrary(record,key);
      return true;
    }

    async function exportEncryptedEnvelope(){
      requireUnlocked();
      await flush();
      if(!record||!record.passwordWrap||record.deviceWrap)throw new Error('Для синхронизации сначала настройте парольную защиту библиотеки на этом устройстве.');
      crypto.validateRecord(record);
      return cloneData(record);
    }

    async function installEncryptedEnvelope(envelope,credential,credentialType){
      if(status==='unlocked')throw new Error('Перед восстановлением сначала заблокируйте библиотеку.');
      crypto.validateRecord(envelope);
      if(!envelope.passwordWrap||envelope.deviceWrap)throw new Error('Облачная копия не поддерживает парольную защиту.');
      var key=credentialType==='recovery'?await crypto.unlockWithRecoveryCode(envelope,credential):await crypto.unlockWithPassword(envelope,credential);
      var opened=await crypto.decryptLibrary(envelope,key);
      if(!opened||typeof opened!=='object'||Array.isArray(opened)||!Array.isArray(opened.books)||!Array.isArray(opened.disciplines))throw new Error('Содержимое облачной копии не прошло проверку.');
      await store.writeVault(envelope,null);
      record=cloneData(envelope);deviceKey=null;dek=null;data=null;status='locked';pendingSetup=null;
      return {status:status,books:opened.books.length};
    }

    function save(nextData){
      requireUnlocked();
      if(lockRequested)throw new Error('Библиотека блокируется. Повторите сохранение после разблокировки.');
      var snapshot=cloneData(nextData===undefined?data:nextData);
      var operation=writeQueue.then(async function(){
        requireUnlocked();
        var updated=await crypto.encryptLibrary(record,dek,snapshot);
        await store.writeVault(updated,deviceKey);
        record=updated;
        data=snapshot;
        writeError=null;
        return true;
      });
      writeQueue=operation.catch(function(error){writeError=error});
      return operation;
    }

    async function lock(){
      if(status!=='unlocked')return {status:status};
      if(lockRequested)return writeQueue.then(function(){return {status:status}});
      lockRequested=true;
      var operation=writeQueue.then(function(){if(writeError){lockRequested=false;throw new Error('Не удалось сохранить последние изменения. Библиотека оставлена разблокированной, чтобы вы могли повторить сохранение.')}dek=null;data=null;status=record?'locked':status;lockRequested=false;return {status:status}});
      writeQueue=operation.catch(function(){lockRequested=false});
      return operation;
    }

    function flush(){return writeQueue}
    function getStatus(){return status}
    function getRecordMetadata(){
      if(!record)return null;
      return {format:record.format,version:record.version,method:record.passwordWrap?'password':'device',updatedAt:null};
    }

    return Object.freeze({
      initialize:initialize,
      prepareSetup:prepareSetup,
      confirmSetup:confirmSetup,
      cancelSetup:cancelSetup,
      unlockWithPassword:unlockWithPassword,
      unlockWithRecoveryCode:unlockWithRecoveryCode,
      unlockWithDevice:unlockWithDevice,
      getData:getData,
      verifyPassword:verifyPassword,
      recoverPasswordWrap:recoverPasswordWrap,
      exportEncryptedEnvelope:exportEncryptedEnvelope,
      installEncryptedEnvelope:installEncryptedEnvelope,
      save:save,
      flush:flush,
      lock:lock,
      getStatus:getStatus,
      getRecordMetadata:getRecordMetadata
    });
  }

  root.InklyVaultRuntime=Object.freeze({create:createRuntime});
  if(typeof module!=='undefined'&&module.exports)module.exports=root.InklyVaultRuntime;
})(typeof globalThis!=='undefined'?globalThis:this);
