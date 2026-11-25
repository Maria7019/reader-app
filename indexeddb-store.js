(function(root){
  'use strict';
  var DB_NAME='inkly-secure-v1';
  var DB_VERSION=1;
  var STORE='vaults';
  var ACTIVE='active';
  var dbPromise=null;
  function fail(message){return Promise.reject(new Error(message))}
  function securityCore(){
    if(!root.InklySecurityCore)throw new Error('Криптографический модуль Inkly не загружен.');
    return root.InklySecurityCore;
  }
  function openDatabase(){
    if(dbPromise)return dbPromise;
    if(!root.indexedDB)return fail('Этот браузер не поддерживает IndexedDB.');
    dbPromise=new Promise(function(resolve,reject){
      var request;
      try{request=root.indexedDB.open(DB_NAME,DB_VERSION)}catch(e){dbPromise=null;reject(e);return}
      request.onupgradeneeded=function(){
        var db=request.result;
        if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'id'});
      };
      request.onsuccess=function(){
        var db=request.result;
        db.onversionchange=function(){db.close();dbPromise=null};
        resolve(db);
      };
      request.onerror=function(){dbPromise=null;reject(request.error||new Error('Не удалось открыть защищённое хранилище.'))};
      request.onblocked=function(){dbPromise=null;reject(new Error('Обновление защищённого хранилища заблокировано другой вкладкой. Закройте другие вкладки Inkly и повторите попытку.'))};
    });
    return dbPromise;
  }
  function readVault(){
    return openDatabase().then(function(db){
      return new Promise(function(resolve,reject){
        var tx,request,result=null,failed=false;
        try{tx=db.transaction(STORE,'readonly');request=tx.objectStore(STORE).get(ACTIVE)}catch(e){reject(e);return}
        request.onsuccess=function(){result=request.result||null};
        request.onerror=function(){failed=true;reject(request.error||new Error('Не удалось прочитать защищённое хранилище.'))};
        tx.oncomplete=function(){
          if(failed)return;
          if(result){
            try{
              securityCore().validateRecord(result.record);
              if(result.record.deviceWrap&&(!result.deviceKey||result.deviceKey.type!=='secret'||result.deviceKey.extractable!==false))throw new Error('В защищённом хранилище отсутствует действительный ключ устройства. Не очищайте данные сайта.');
              if(result.record.passwordWrap&&result.deviceKey)throw new Error('В защищённом хранилище обнаружен неожиданный локальный ключ. Не очищайте данные сайта.');
            }catch(e){reject(e);return}
          }
          resolve(result?{record:result.record,deviceKey:result.deviceKey||null,updatedAt:result.updatedAt||null}:null);
        };
        tx.onerror=function(){failed=true;reject(tx.error||new Error('Ошибка чтения защищённого хранилища.'))};
        tx.onabort=function(){failed=true;reject(tx.error||new Error('Чтение защищённого хранилища прервано.'))};
      });
    });
  }
  function writeVault(record,deviceKey){
    try{
      securityCore().validateRecord(record);
      if(record.deviceWrap){
        if(!deviceKey||deviceKey.type!=='secret'||deviceKey.extractable!==false)throw new Error('Для режима без пароля требуется неэкспортируемый ключ устройства.');
      }else if(deviceKey)throw new Error('В режиме с паролем не должен сохраняться локальный ключ устройства.');
    }catch(e){return fail(e.message||String(e))}
    return openDatabase().then(function(db){
      return new Promise(function(resolve,reject){
        var tx;
        try{
          tx=db.transaction(STORE,'readwrite');
          tx.objectStore(STORE).put({id:ACTIVE,record:record,deviceKey:deviceKey||null,updatedAt:Date.now()});
        }catch(e){reject(e);return}
        tx.oncomplete=function(){resolve(true)};
        tx.onerror=function(){reject(tx.error||new Error('Не удалось сохранить защищённую библиотеку.'))};
        tx.onabort=function(){reject(tx.error||new Error('Сохранение защищённой библиотеки было отменено.'))};
      });
    });
  }
  function probeCryptoKeyStorage(deviceKey){
    if(!deviceKey||deviceKey.type!=='secret'||deviceKey.extractable!==false)return fail('Для проверки нужен неэкспортируемый ключ устройства.');
    return openDatabase().then(function(db){
      return new Promise(function(resolve,reject){
        var tx,store,request,readback,failed=false;
        try{
          tx=db.transaction(STORE,'readwrite');
          store=tx.objectStore(STORE);
          store.put({id:'__crypto_key_probe__',deviceKey:deviceKey});
          request=store.get('__crypto_key_probe__');
        }catch(e){reject(e);return}
        request.onsuccess=function(){readback=request.result&&request.result.deviceKey};
        request.onerror=function(){failed=true;reject(request.error||new Error('Браузер не смог проверить сохранение криптографического ключа.'))};
        tx.oncomplete=function(){
          if(failed)return;
          try{
            if(!readback||readback.type!=='secret'||readback.extractable!==false)throw new Error('Браузер не сохранил ключ устройства в защищённом виде.');
            resolve(true);
          }catch(e){reject(e)}
        };
        tx.onerror=function(){failed=true;reject(tx.error||new Error('Браузер не поддерживает безопасное сохранение ключа устройства.'))};
        tx.onabort=function(){failed=true;reject(tx.error||new Error('Проверка сохранения ключа устройства прервана.'))};
        tx.addEventListener('complete',function(){
          try{var cleanup=db.transaction(STORE,'readwrite');cleanup.objectStore(STORE).delete('__crypto_key_probe__')}catch(e){}
        });
      });
    });
  }
  function close(){
    if(!dbPromise)return;
    dbPromise.then(function(db){db.close()}).catch(function(){});
    dbPromise=null;
  }
  root.InklyIndexedStore=Object.freeze({
    databaseName:DB_NAME,
    open:openDatabase,
    readVault:readVault,
    writeVault:writeVault,
    probeCryptoKeyStorage:probeCryptoKeyStorage,
    close:close
  });
  if(typeof module!=='undefined'&&module.exports)module.exports=root.InklyIndexedStore;
})(typeof globalThis!=='undefined'?globalThis:this);
