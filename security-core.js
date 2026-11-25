(function(root){
  'use strict';
  var FORMAT='inkly-encrypted-v1';
  var PBKDF2_ITERATIONS=600000;
  var encoder=new TextEncoder();
  var decoder=new TextDecoder('utf-8',{fatal:true});
  function cryptoApi(){
    var c=root.crypto;
    if(!c||!c.subtle||!c.getRandomValues)throw new Error('Для защищённого хранилища нужен браузер с поддержкой Web Crypto и безопасный контекст HTTPS.');
    return c;
  }
  function bytesToBase64(bytes){
    var binary='';
    for(var i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  function base64ToBytes(value){
    if(typeof value!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw new Error('Некорректные двоичные данные.');
    var binary=atob(value),out=new Uint8Array(binary.length);
    for(var i=0;i<binary.length;i++)out[i]=binary.charCodeAt(i);
    return out;
  }
  function randomBytes(length){
    var out=new Uint8Array(length);cryptoApi().getRandomValues(out);return out;
  }
    async function importAesKey(raw,extractable){
    return cryptoApi().subtle.importKey('raw',raw,{name:'AES-GCM'},extractable,['encrypt','decrypt']);
  }
  async function encryptBytes(key,plain,aad){
    var iv=randomBytes(12);
    var params={name:'AES-GCM',iv:iv,tagLength:128};
    if(aad)params.additionalData=encoder.encode(aad);
    var cipher=await cryptoApi().subtle.encrypt(params,key,plain);
    return {iv:bytesToBase64(iv),ciphertext:bytesToBase64(new Uint8Array(cipher))};
  }
  async function decryptBytes(key,record,aad){
    var params={name:'AES-GCM',iv:base64ToBytes(record.iv),tagLength:128};
    if(aad)params.additionalData=encoder.encode(aad);
    var plain=await cryptoApi().subtle.decrypt(params,key,base64ToBytes(record.ciphertext));
    return new Uint8Array(plain);
  }
  async function derivePasswordKey(password,salt,iterations){
    if(typeof password!=='string'||password.length<12)throw new Error('Пароль должен содержать не менее 12 символов.');
    var material=await cryptoApi().subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveKey']);
    return cryptoApi().subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:salt,iterations:iterations},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  async function createVault(initialData,password){
    var hasPassword=typeof password==='string'&&password.length>0;
    if(password!==undefined&&password!==null&&password!==''&&(!hasPassword||password.length<12))throw new Error('Пароль должен содержать не менее 12 символов.');
    if(!initialData||typeof initialData!=='object'||Array.isArray(initialData))throw new Error('Начальные данные библиотеки имеют неверный формат.');
    cryptoApi();
    var dekRaw=randomBytes(32),dek=await importAesKey(dekRaw,true);
    var passwordWrap=null,deviceWrap=null,deviceKey=null,kdf=null;
    if(hasPassword){
      var passwordSalt=randomBytes(16),passwordKey=await derivePasswordKey(password,passwordSalt,PBKDF2_ITERATIONS);
      passwordWrap=await encryptBytes(passwordKey,dekRaw,'inkly:dek:password:v1');
      passwordWrap.salt=bytesToBase64(passwordSalt);
      kdf={name:'PBKDF2-HMAC-SHA-256',iterations:PBKDF2_ITERATIONS};
    }else{
      deviceKey=await cryptoApi().subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
      deviceWrap=await encryptBytes(deviceKey,dekRaw,'inkly:dek:device:v1');
    }
    var recoveryRaw=randomBytes(32),recoveryCode=bytesToBase64(recoveryRaw).replace(/=/g,'');
    var recoveryKey=await importAesKey(recoveryRaw,false);
    var recoveryWrap=await encryptBytes(recoveryKey,dekRaw,'inkly:dek:recovery:v1');
    var serialized=JSON.stringify(initialData);
    if(typeof serialized!=='string')throw new Error('Не удалось сериализовать библиотеку.');
    var plainBytes=encoder.encode(serialized);
    if(plainBytes.length>50*1024*1024)throw new Error('Размер библиотеки превышает допустимый предел.');
    var payload=await encryptBytes(dek,plainBytes,'inkly:library:v1');
    var record={
      format:FORMAT,
      version:1,
      cipher:'AES-256-GCM',
      kdf:kdf,
      passwordWrap:passwordWrap?{salt:passwordWrap.salt,iv:passwordWrap.iv,ciphertext:passwordWrap.ciphertext}:null,
      deviceWrap:deviceWrap,
      recoveryWrap:{iv:recoveryWrap.iv,ciphertext:recoveryWrap.ciphertext},
      payload:{iv:payload.iv,ciphertext:payload.ciphertext}
    };
    dekRaw.fill(0);recoveryRaw.fill(0);plainBytes.fill(0);
    return {record:record,recoveryCode:recoveryCode,deviceKey:deviceKey};
  }
  async function unlockWithPassword(record,password){
    validateRecord(record);
    if(!record.passwordWrap)throw new Error('Для этой библиотеки не настроен парольный доступ.');
    var salt=base64ToBytes(record.passwordWrap.salt);
    var key=await derivePasswordKey(password,salt,record.kdf.iterations);
    var raw=await decryptBytes(key,record.passwordWrap,'inkly:dek:password:v1');
    try{return await importAesKey(raw,false)}finally{raw.fill(0)}
  }
  async function unlockWithDeviceKey(record,deviceKey){
    validateRecord(record);
    if(!record.deviceWrap)throw new Error('Для этой библиотеки не настроен локальный ключ устройства.');
    if(!deviceKey||deviceKey.type!=='secret'||deviceKey.extractable!==false)throw new Error('Локальный ключ устройства недействителен.');
    var raw=await decryptBytes(deviceKey,record.deviceWrap,'inkly:dek:device:v1');
    try{return await importAesKey(raw,false)}finally{raw.fill(0)}
  }
  async function unlockWithRecoveryCode(record,code){
    validateRecord(record);
    if(typeof code!=='string')throw new Error('Ключ восстановления введён в неверном формате.');
    var normalized=code.replace(/\s+/g,'');
    var raw=base64ToBytes(normalized);
    if(raw.length!==32)throw new Error('Ключ восстановления введён в неверном формате.');
    var key=await importAesKey(raw,false);
    raw.fill(0);
    var dekRaw=await decryptBytes(key,record.recoveryWrap,'inkly:dek:recovery:v1');
    try{return await importAesKey(dekRaw,false)}finally{dekRaw.fill(0)}
  }
  async function decryptLibrary(record,key){
    validateRecord(record);
    var plain=await decryptBytes(key,record.payload,'inkly:library:v1');
    try{return JSON.parse(decoder.decode(plain))}catch(e){throw new Error('Зашифрованная библиотека повреждена или имеет неверный формат.')}
    finally{plain.fill(0)}
  }
  async function encryptLibrary(record,key,data){
    validateRecord(record);
    if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Данные библиотеки имеют неверный формат.');
    var serialized=JSON.stringify(data);
    if(typeof serialized!=='string')throw new Error('Не удалось сериализовать библиотеку.');
    var plainBytes=encoder.encode(serialized);
    if(plainBytes.length>50*1024*1024)throw new Error('Размер библиотеки превышает допустимый предел.');
    var payload=await encryptBytes(key,plainBytes,'inkly:library:v1');
    return Object.assign({},record,{payload:payload});
  }
  function validateRecord(record){
    if(!record||typeof record!=='object'||record.format!==FORMAT||record.version!==1||record.cipher!=='AES-256-GCM')throw new Error('Формат или алгоритм защищённого хранилища не поддерживается.');
    var hasPassword=!!record.passwordWrap,hasDevice=!!record.deviceWrap;
    if(hasPassword===hasDevice)throw new Error('Для защищённого хранилища должен быть задан ровно один основной способ разблокировки.');
    if(hasPassword){
      if(!record.kdf||record.kdf.name!=='PBKDF2-HMAC-SHA-256'||!Number.isSafeInteger(record.kdf.iterations)||record.kdf.iterations<600000||record.kdf.iterations>2000000)throw new Error('Параметры защиты пароля некорректны.');
      if(typeof record.passwordWrap.salt!=='string'||base64ToBytes(record.passwordWrap.salt).length!==16)throw new Error('Соль защищённого хранилища повреждена.');
    }else if(record.kdf!==null&&record.kdf!==undefined)throw new Error('Неверные параметры локального ключа устройства.');
    ['recoveryWrap','payload'].concat(hasPassword?['passwordWrap']:['deviceWrap']).forEach(function(k){
      var x=record[k];if(!x||typeof x.iv!=='string'||typeof x.ciphertext!=='string')throw new Error('Запись защищённого хранилища неполная.');
      var iv=base64ToBytes(x.iv),ciphertext=base64ToBytes(x.ciphertext);if(iv.length!==12||ciphertext.length<16||ciphertext.length>50*1024*1024+16)throw new Error('Запись защищённого хранилища повреждена или слишком велика.');
    });
    return true;
  }
  root.InklySecurityCore=Object.freeze({
    format:FORMAT,
    pbkdf2Iterations:PBKDF2_ITERATIONS,
    createVault:createVault,
    unlockWithPassword:unlockWithPassword,
    unlockWithDeviceKey:unlockWithDeviceKey,
    unlockWithRecoveryCode:unlockWithRecoveryCode,
    decryptLibrary:decryptLibrary,
    encryptLibrary:encryptLibrary,
    validateRecord:validateRecord
  });
  if(typeof module!=='undefined'&&module.exports)module.exports=root.InklySecurityCore;
})(typeof globalThis!=='undefined'?globalThis:this);
