(function(){
  if(!('serviceWorker' in navigator)||!/^https?:$/.test(location.protocol))return;
  window.addEventListener('load',function(){
    navigator.serviceWorker.register('./service-worker.js',{scope:'./'}).catch(function(error){console.warn('Inkly offline shell is unavailable:',error)});
  });
})();
