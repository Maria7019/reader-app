(function(root){
  'use strict';
  var DB='inkly-secure-v1',VERSION=2,STORE='auth_sessions',KEY='supabase-session',dbPromise=null;
  function open(){
    if(dbPromise)return dbPromise;
    if(!root.indexedDB)return Promise.reject(new Error('Для хранения сессии нужен IndexedDB.'));
    dbPromise=new Promise(function(resolve,reject){
      var request;
      try{request=root.indexedDB.open(DB,VERSION)}catch(e){dbPromise=null;reject(e);return}
      request.onupgradeneeded=function(){
        var db=request.result;
        if(!db.objectStoreNames.contains('vaults'))db.createObjectStore('vaults',{keyPath:'id'});
        if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'id'});
      };
      request.onsuccess=function(){var db=request.result;db.onversionchange=function(){db.close();dbPromise=null};resolve(db)};
      request.onerror=function(){dbPromise=null;reject(request.error||new Error('Не удалось открыть хранилище сессии.'))};
      request.onblocked=function(){dbPromise=null;reject(new Error('Закройте другие вкладки Inkly и повторите попытку.'))};
    });
    return dbPromise;
  }
  function transaction(mode,action){
    return open().then(function(db){return new Promise(function(resolve,reject){
      var tx,result;
      try{tx=db.transaction(STORE,mode);result=action(tx.objectStore(STORE))}catch(e){reject(e);return}
      tx.oncomplete=function(){resolve(result&&result.result!==undefined?result.result:result)};
      tx.onerror=function(){reject(tx.error||new Error('Ошибка хранилища сессии.'))};
      tx.onabort=function(){reject(tx.error||new Error('Операция сессии отменена.'))};
    })});
  }
  function getItem(key){
    if(key!=='supabase.auth.token')return Promise.resolve(null);
    return open().then(function(db){return new Promise(function(resolve,reject){
      var tx=db.transaction(STORE,'readonly'),req=tx.objectStore(STORE).get(KEY),value=null;
      req.onsuccess=function(){value=req.result?req.result.value:null};
      req.onerror=function(){reject(req.error||new Error('Не удалось прочитать сессию.'))};
      tx.oncomplete=function(){resolve(value)};
      tx.onerror=function(){reject(tx.error||new Error('Ошибка чтения сессии.'))};
    })});
  }
  function setItem(key,value){
    if(key!=='supabase.auth.token')return Promise.resolve();
    return transaction('readwrite',function(store){return store.put({id:KEY,value:value,updatedAt:Date.now()})});
  }
  function removeItem(key){
    if(key!=='supabase.auth.token')return Promise.resolve();
    return transaction('readwrite',function(store){return store.delete(KEY)});
  }
  root.InklyAuthStorage=Object.freeze({getItem:getItem,setItem:setItem,removeItem:removeItem});
})(typeof globalThis!=='undefined'?globalThis:this);
