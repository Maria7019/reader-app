(function(root){
  'use strict';
  var config=root.INKLY_SUPABASE_CONFIG;
  var session=null,user=null,refreshPromise=null;
  var base=config&&config.url,apiKey=config&&config.publishableKey;
  function ready(){if(!base||!apiKey)throw new Error('Не настроено подключение к серверу Inkly.');if(!root.InklyAuthStorage)throw new Error('Хранилище сессии не загружено.')}
  function parse(text){try{return text?JSON.parse(text):{}}catch(e){return {message:'Сервер вернул некорректный ответ.'}}}
  async function request(path,options){
    ready();options=options||{};var headers=new Headers(options.headers||{});
    headers.set('apikey',apiKey);headers.set('Accept','application/json');
    if(options.body!==undefined){headers.set('Content-Type','application/json');options.body=JSON.stringify(options.body)}
    var response=await fetch(base+path,Object.assign({},options,{headers:headers,credentials:'omit',cache:'no-store'}));
    var payload=parse(await response.text());
    if(!response.ok){var message=payload.msg||payload.message||payload.error_description||payload.error||'Запрос к серверу не выполнен.';throw new Error(message)}
    return payload;
  }
  async function saveSession(value){
    session=value||null;
    if(session&&session.expires_in&&!session.expires_at)session.expires_at=Math.floor(Date.now()/1000)+session.expires_in;
    await root.InklyAuthStorage.setItem('supabase.auth.token',session?JSON.stringify(session):null);
    user=session&&session.user||null;
    return session;
  }
  async function loadSession(){
    ready();if(session)return session;
    var raw=await root.InklyAuthStorage.getItem('supabase.auth.token');
    if(!raw)return null;
    try{session=typeof raw==='string'?JSON.parse(raw):raw;user=session.user||null}catch(e){session=null;user=null}
    if(session&&session.expires_at&&session.expires_at<Date.now()/1000+30)return refresh();
    return session;
  }
  async function refresh(){
    if(refreshPromise)return refreshPromise;
    refreshPromise=(async function(){
      var current=session||await loadSession();
      if(!current||!current.refresh_token){await saveSession(null);return null}
      try{
        var next=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:current.refresh_token}});
        await saveSession(next);return session;
      }catch(e){await saveSession(null);throw new Error('Сеанс Inkly истёк. Войдите снова.')};
    })();
    try{return await refreshPromise}finally{refreshPromise=null}
  }
  async function accessToken(){
    var current=await loadSession();if(!current)return null;
    if(current.expires_at&&current.expires_at<Date.now()/1000+60)current=await refresh();
    return current&&current.access_token||null;
  }
  async function signUp(email,password,redirectTo){
    var result=await request('/auth/v1/signup'+(redirectTo?'?redirect_to='+encodeURIComponent(redirectTo):''),{method:'POST',body:{email:email,password:password}});
    if(result.access_token)await saveSession(result);
    return result;
  }
  async function signIn(email,password){
    var result=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email:email,password:password}});
    await saveSession(result);return result;
  }
  async function sendPasswordReset(email,redirectTo){
    return request('/auth/v1/recover?redirect_to='+encodeURIComponent(redirectTo),{method:'POST',body:{email:email}});
  }
  async function updatePassword(password){
    var token=await accessToken();if(!token)throw new Error('Сначала подтвердите ссылку восстановления и войдите в аккаунт.');
    var result=await request('/auth/v1/user',{method:'PUT',headers:{Authorization:'Bearer '+token},body:{password:password}});
    if(result&&result.id)user=result;return result;
  }
  async function signOut(){
    var token=await accessToken();
    try{if(token)await request('/auth/v1/logout',{method:'POST',headers:{Authorization:'Bearer '+token}})}finally{await saveSession(null)}
  }
  async function currentUser(){
    var token=await accessToken();if(!token)return null;
    var result=await request('/auth/v1/user',{headers:{Authorization:'Bearer '+token}});
    user=result; if(session)session.user=result; return result;
  }
  async function handleAuthCallback(){
    var hash=root.location&&root.location.hash||'';
    if(!hash||hash.length>8192)return null;
    var params=new URLSearchParams(hash.slice(1));
    var access=params.get('access_token'),refreshToken=params.get('refresh_token'),type=params.get('type');
    if(!access||!refreshToken)return null;
    var result={access_token:access,refresh_token:refreshToken,token_type:params.get('token_type')||'bearer',expires_in:Number(params.get('expires_in')||3600),expires_at:Math.floor(Date.now()/1000)+Number(params.get('expires_in')||3600),user:null};
    await saveSession(result);
    if(root.history&&root.history.replaceState)root.history.replaceState(null,'',root.location.pathname+root.location.search);
    if(type==='recovery')return {type:'recovery'};
    return {type:type||'confirmed'};
  }
  root.InklyAuth=Object.freeze({signUp:signUp,signIn:signIn,signOut:signOut,sendPasswordReset:sendPasswordReset,updatePassword:updatePassword,loadSession:loadSession,currentUser:currentUser,accessToken:accessToken,handleAuthCallback:handleAuthCallback,getSession:function(){return session},getUser:function(){return user}});
})(typeof globalThis!=='undefined'?globalThis:this);
